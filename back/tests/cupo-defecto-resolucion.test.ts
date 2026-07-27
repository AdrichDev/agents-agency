/**
 * H7 (aa-cupo-defecto-y-avisos, T1.6) — Cupo por defecto de la plataforma.
 *
 * Qué cierra: hasta aquí un tenant sin override y sin plan resolvía cupo 0 con motivo `"none"`, y el
 * gate lo cortaba con un 402 propio. Un cliente recién dado de alta llega exactamente en ese estado,
 * así que nacía muerto: su agente no contestaba hasta que alguien entrara a la base a ponerle el saldo
 * a mano. Eso es lo que hacían los 11 tenants de producción con `saldo = 10.000.000`.
 *
 * El riesgo del change es el contrario, y es el que este fichero vigila: aflojar el gate del dinero no
 * puede desactivar el freno de mano. Los 4 tenants bloqueados a propósito con `saldo = 0` siguen
 * bloqueados, porque `0` es un valor puesto por alguien y no un hueco.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_TOKEN_QUOTA_PER_AGENT,
  resolveTokenQuota,
  quotaNeedsAgentCount,
  resolveAgentQuota,
} from "@/lib/quota";

describe("T1 — AC1: sin override y sin plan se aplica el defecto", () => {
  it("multiplica por agentes facturables, igual que el plan", () => {
    expect(resolveTokenQuota({ tokenBalance: null }, 3)).toEqual({
      limit: DEFAULT_TOKEN_QUOTA_PER_AGENT * 3,
      source: "default",
    });
  });

  it("`plan: null` explícito es lo mismo que no traer plan", () => {
    expect(resolveTokenQuota({ tokenBalance: null, plan: null }, 1)).toEqual({
      limit: DEFAULT_TOKEN_QUOTA_PER_AGENT,
      source: "default",
    });
  });

  it("suelo 1: un tenant con todo en borrador puede probar su agente antes de publicarlo", () => {
    // Mismo motivo que el suelo del plan (H4 T4): el flujo es crear → probar → publicar, así que un
    // cupo que exige publicar primero lo haría imposible.
    expect(resolveTokenQuota({ tokenBalance: null }, 0).limit).toBe(DEFAULT_TOKEN_QUOTA_PER_AGENT);
  });

  it("el defecto es el número que se anuncia: 10M", () => {
    expect(DEFAULT_TOKEN_QUOTA_PER_AGENT).toBe(10_000_000);
  });
});

describe("T1 — AC2 / R1: el freno de mano gana al defecto", () => {
  it("`tokenBalance = 0` sigue siendo cupo 0, no 10M", () => {
    expect(resolveTokenQuota({ tokenBalance: 0 }, 5)).toEqual({ limit: 0, source: "override" });
  });

  it("`tokenBalance = 0` tampoco se multiplica por agentes", () => {
    expect(resolveTokenQuota({ tokenBalance: 0 }, 99).limit).toBe(0);
  });

  it("un override negativo mal puesto tampoco abre la puerta", () => {
    expect(resolveTokenQuota({ tokenBalance: -1 }, 3).limit).toBe(-1);
  });
});

describe("T1 — AC3 / AC4: el orden override → plan → defecto no cambia", () => {
  it("el override gana al plan", () => {
    expect(
      resolveTokenQuota({ tokenBalance: 500, plan: { tokenQuotaPerAgent: 1_000 } }, 4)
    ).toEqual({ limit: 500, source: "override" });
  });

  it("el plan gana al defecto", () => {
    expect(resolveTokenQuota({ tokenBalance: null, plan: { tokenQuotaPerAgent: 1_000 } }, 2)).toEqual(
      { limit: 2_000, source: "plan" }
    );
  });

  it("plan con `tokenQuotaPerAgent: null` sigue siendo SIN TOPE, no cae al defecto", () => {
    // "Sin plan" y "plan que no pone tope" son cosas distintas (H4 T5). Sólo la primera cae al
    // defecto; confundirlas convertiría un sin-tope deliberado en un tope de 10M.
    expect(resolveTokenQuota({ tokenBalance: null, plan: { tokenQuotaPerAgent: null } }, 7)).toEqual({
      limit: null,
      source: "plan",
    });
  });
});

describe("T1 — AC5: `none` ya no lo produce ningún dato", () => {
  const casos = [
    { tokenBalance: null },
    { tokenBalance: null, plan: null },
    { tokenBalance: 0 },
    { tokenBalance: 10_000_000 },
    { tokenBalance: null, plan: { tokenQuotaPerAgent: null } },
    { tokenBalance: null, plan: { tokenQuotaPerAgent: 1 } },
  ];

  it("ninguna combinación de entradas devuelve el motivo retirado", () => {
    for (const c of casos) {
      for (const agentes of [0, 1, 5]) {
        expect(resolveTokenQuota(c, agentes).source).not.toBe("none");
      }
    }
  });
});

describe("T1 — AC12: los tenants de producción de hoy no cambian", () => {
  it("con override el cupo es el mismo de antes y no hace falta contar agentes", () => {
    // Los 15 tenants de producción tienen override, así que el impacto del change hoy es cero: mismo
    // número y ninguna consulta nueva.
    const tenant = { tokenBalance: 10_000_000 };
    expect(resolveTokenQuota(tenant, 0)).toEqual({ limit: 10_000_000, source: "override" });
    expect(quotaNeedsAgentCount(tenant)).toBe(false);
  });

  it("sin override sí hay que contar, con o sin plan", () => {
    expect(quotaNeedsAgentCount({ tokenBalance: null })).toBe(true);
    expect(quotaNeedsAgentCount({ tokenBalance: null, plan: { tokenQuotaPerAgent: 10 } })).toBe(true);
  });

  it("sin override y con plan sin tope no hace falta contar: no hay nada que multiplicar", () => {
    expect(quotaNeedsAgentCount({ tokenBalance: null, plan: { tokenQuotaPerAgent: null } })).toBe(
      false
    );
  });
});

describe("T1.5 — el tope por agente y el del tenant salen del mismo dato", () => {
  it("con un solo agente los dos topes coinciden en el mismo número", () => {
    const tenant = { tokenBalance: null };
    expect(resolveTokenQuota(tenant, 1).limit).toBe(resolveAgentQuota({ tokenQuotaOverride: null }, tenant).limit);
  });

  it("con tres agentes el tenant tiene 30M y cada agente 10M", () => {
    const tenant = { tokenBalance: null };
    expect(resolveTokenQuota(tenant, 3).limit).toBe(30_000_000);
    expect(resolveAgentQuota({ tokenQuotaOverride: null }, tenant).limit).toBe(10_000_000);
  });

  it("el override del tenant no se subdivide: sigue siendo un total", () => {
    // Un tenant con 50M a mano y tres agentes tendría 30M utilizables si cada agente se topara en
    // 10M. El ajuste manual se habría deshecho solo.
    expect(resolveAgentQuota({ tokenQuotaOverride: null }, { tokenBalance: 50_000_000 }).limit).toBe(
      null
    );
  });
});
