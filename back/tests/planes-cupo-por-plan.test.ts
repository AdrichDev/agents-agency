/**
 * H4 (aa-planes-y-cuotas, T4.2 / T4.3 / T4.4) — Cupo por plan, override del propietario y recuento
 * facturable.
 *
 * Lo que cierra T4: hasta ahora el cupo era una columna suelta con un default de diez millones que
 * nadie decidía, sin relación con lo contratado. Desde aquí el cupo sale del PLAN (por agente
 * activo) y `tokenBalance` pasa a ser un OVERRIDE manual. Ninguna de las dos cosas es un precio: el
 * importe vive en Stripe (ver `planes-plan-sin-importes.test.ts`).
 *
 * `resolveTokenQuota` se prueba en puro porque es la función que decide el corte, y el gate se
 * prueba de verdad (con prisma mockeado) porque el riesgo real es que el gate resuelva el cupo de
 * una forma y el panel lo pinte de otra.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findUnique: vi.fn(), updateMany: vi.fn() },
    agent: { count: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import {
  resolveTokenQuota,
  quotaNeedsAgentCount,
  billableAgentFilter,
  countBillableAgents,
} from "@/lib/quota";
import { checkClientBalance } from "@/lib/token-metering";

const mockFind = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const mockAgentCount = prisma.agent.count as ReturnType<typeof vi.fn>;

/** Fila del tenant tal como la lee el gate desde T4 (cupo = override nullable + plan). */
const row = (over: Record<string, unknown> = {}) => ({
  isActive: true,
  tokenBalance: null,
  plan: null,
  tokensUsedPeriod: 0,
  periodStart: new Date(),
  periodAnchorDay: 1,
  credentialMode: "platform",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.tenant.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
  mockAgentCount.mockResolvedValue(0);
});

describe("T4.2 — el override del propietario gana al plan", () => {
  it("con `tokenBalance` puesto, el cupo es ese y el plan no pinta nada", () => {
    const q = resolveTokenQuota({ tokenBalance: 500, plan: { tokenQuotaPerAgent: 9_999 } }, 7);
    expect(q).toEqual({ limit: 500, source: "override" });
  });

  it("`tokenBalance: 0` sigue siendo BLOQUEADO, no 'sin override'", () => {
    // Hay tenants en producción a 0 justamente para tenerlos cortados. Si el 0 se leyera como
    // "que decida el plan", el kill switch manual haría lo contrario de lo que dice.
    const q = resolveTokenQuota({ tokenBalance: 0, plan: { tokenQuotaPerAgent: 1_000_000 } }, 3);
    expect(q).toEqual({ limit: 0, source: "override" });
  });

  it("sin override y sin plan: cupo cero y motivo 'none' (fail-closed)", () => {
    expect(resolveTokenQuota({ tokenBalance: null }, 5)).toEqual({ limit: 0, source: "none" });
    expect(resolveTokenQuota({ tokenBalance: null, plan: null }, 5).source).toBe("none");
  });
});

describe("T4.3 — el cupo del plan es POR AGENTE activo", () => {
  const plan = { tokenQuotaPerAgent: 1_000 };

  it("multiplica por los agentes facturables", () => {
    expect(resolveTokenQuota({ tokenBalance: null, plan }, 3)).toEqual({
      limit: 3_000,
      source: "plan",
    });
  });

  it("suelo 1: sin nada publicado el cupo es de un agente, no cero", () => {
    // El flujo es crear → probar → publicar. Con cupo cero no se puede probar antes de publicar,
    // así que el tope exigiría publicar primero. Regalar nada: la factura es el recuento, que sí
    // es cero mientras no haya nada publicado.
    expect(resolveTokenQuota({ tokenBalance: null, plan }, 0).limit).toBe(1_000);
  });

  it("cupo por agente `null` = SIN TOPE, y no se multiplica ni se convierte en 0", () => {
    const q = resolveTokenQuota({ tokenBalance: null, plan: { tokenQuotaPerAgent: null } }, 4);
    expect(q).toEqual({ limit: null, source: "plan" });
  });

  it("no devuelve importes: la resolución sólo tiene `limit` y `source`", () => {
    const q = resolveTokenQuota({ tokenBalance: null, plan }, 2);
    expect(Object.keys(q).sort()).toEqual(["limit", "source"]);
  });
});

describe("T4.3 — `quotaNeedsAgentCount` evita la consulta cuando no cambia nada", () => {
  it("con override no hace falta contar agentes", () => {
    expect(quotaNeedsAgentCount({ tokenBalance: 10, plan: { tokenQuotaPerAgent: 1 } })).toBe(false);
  });

  it("sin plan tampoco: el cupo ya está decidido (cero)", () => {
    expect(quotaNeedsAgentCount({ tokenBalance: null, plan: null })).toBe(false);
  });

  it("con plan sin tope tampoco: multiplicar el infinito no significa nada", () => {
    expect(quotaNeedsAgentCount({ tokenBalance: null, plan: { tokenQuotaPerAgent: null } })).toBe(
      false
    );
  });

  it("con plan y tope por agente sí hace falta", () => {
    expect(quotaNeedsAgentCount({ tokenBalance: null, plan: { tokenQuotaPerAgent: 100 } })).toBe(
      true
    );
  });
});

describe("T4.4 — recuento facturable: publicado y suspendido cuentan; borrador no", () => {
  it("el filtro incluye `published` y `suspended`, y excluye `draft` y `archived`", () => {
    const f = billableAgentFilter("t1");
    expect(f.tenantId).toBe("t1");
    expect([...f.status.in].sort()).toEqual(["published", "suspended"]);
    expect(f.status.in).not.toContain("draft");
    expect(f.status.in).not.toContain("archived");
  });

  it("el recuento devuelve un entero y no lleva importes", async () => {
    mockAgentCount.mockResolvedValue(3);
    const n = await countBillableAgents("t1");
    expect(n).toBe(3);
    expect(Number.isInteger(n)).toBe(true);
    expect(mockAgentCount).toHaveBeenCalledWith({ where: billableAgentFilter("t1") });
  });

  it("publicar y despublicar mueve el cupo, porque mueve el recuento", () => {
    // Sin BD: el recuento es la entrada de la resolución, así que basta comprobar que el cupo se
    // desplaza con él. Publicar un tercer agente sube el tope; archivarlo lo devuelve.
    const plan = { tokenQuotaPerAgent: 2_000 };
    const conDos = resolveTokenQuota({ tokenBalance: null, plan }, 2).limit;
    const conTres = resolveTokenQuota({ tokenBalance: null, plan }, 3).limit;
    expect(conTres).toBe(6_000);
    expect(conDos).toBe(4_000);
    expect(conTres! - conDos!).toBe(2_000);
  });
});

describe("T4 — el gate real aplica el cupo resuelto", () => {
  it("sin plan ni override: 402 con motivo propio (no es 'se agotó')", async () => {
    mockFind.mockResolvedValue(row());

    await expect(checkClientBalance("t1")).rejects.toMatchObject({ status: 402 });
    await expect(checkClientBalance("t1")).rejects.toThrow(/plan de uso/i);
  });

  it("plan con tope por agente: corta al superar cupo × agentes", async () => {
    mockAgentCount.mockResolvedValue(2);
    mockFind.mockResolvedValue(
      row({ plan: { tokenQuotaPerAgent: 1_000 }, tokensUsedPeriod: 2_000 })
    );

    await expect(checkClientBalance("t1")).rejects.toThrow(/cupo de uso/i);
  });

  it("plan con tope por agente: deja pasar por debajo del cupo multiplicado", async () => {
    mockAgentCount.mockResolvedValue(2);
    mockFind.mockResolvedValue(
      row({ plan: { tokenQuotaPerAgent: 1_000 }, tokensUsedPeriod: 1_999 })
    );

    await expect(checkClientBalance("t1")).resolves.toBe("platform");
    expect(mockAgentCount).toHaveBeenCalledTimes(1);
  });

  it("plan sin tope: no corta ni con consumo enorme", async () => {
    mockFind.mockResolvedValue(
      row({ plan: { tokenQuotaPerAgent: null }, tokensUsedPeriod: 50_000_000 })
    );

    await expect(checkClientBalance("t1")).resolves.toBe("platform");
    // Sin tope no hay nada que multiplicar: no se paga la consulta de agentes.
    expect(mockAgentCount).not.toHaveBeenCalled();
  });

  it("con override no cuenta agentes: una consulta menos por mensaje", async () => {
    mockFind.mockResolvedValue(row({ tokenBalance: 1_000, tokensUsedPeriod: 10 }));

    await expect(checkClientBalance("t1")).resolves.toBe("platform");
    expect(mockAgentCount).not.toHaveBeenCalled();
  });

  it("byok sin plan NO se corta: el cliente paga su propio LLM", async () => {
    // El cupo es el guardarraíl del gasto del propietario. En byok ese gasto no existe, así que
    // exigir plan aquí bloquearía a quien no le cuesta nada servir.
    mockFind.mockResolvedValue(row({ credentialMode: "byok" }));

    await expect(checkClientBalance("t1")).resolves.toBe("byok");
    expect(mockAgentCount).not.toHaveBeenCalled();
  });

  it("`isActive: false` manda sobre el plan: impago corta antes de mirar cupo", async () => {
    mockFind.mockResolvedValue(
      row({ isActive: false, plan: { tokenQuotaPerAgent: null } })
    );

    await expect(checkClientBalance("t1")).rejects.toThrow(/desactivado/i);
  });
});
