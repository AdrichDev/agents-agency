/**
 * H4 (aa-planes-y-cuotas, T5) — Cuota por agente.
 *
 * Con el cobro por agente activo (T4), el cupo del tenant es un bote común: el agente que más habla
 * se come el cupo que otro ya está pagando. T5 pone un tope a cada agente.
 *
 * El consumo por agente se **deriva de `uso_tokens`** en vez de cachearse en una columna: es la
 * fuente de verdad, y el contador cacheado del tenant ya obligó a escribir un script de
 * reconciliación en T3.4. Estos tests fijan las dos cosas que importan de esa decisión: QUÉ se suma
 * (periodo vigente, sólo modo plataforma) y CUÁNDO se paga la suma (sólo si hay tope que comparar).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findUnique: vi.fn(), updateMany: vi.fn() },
    agent: { count: vi.fn() },
    tokenUsage: { aggregate: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import {
  DEFAULT_TOKEN_QUOTA_PER_AGENT,
  resolveAgentQuota,
  sumAgentPeriodUsage,
} from "@/lib/quota";
import { checkClientBalance } from "@/lib/token-metering";

const mockFind = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const mockAggregate = prisma.tokenUsage.aggregate as ReturnType<typeof vi.fn>;

const PERIOD_START = new Date("2026-07-27T00:00:00.000Z");

/** Fila del tenant tal como la lee el gate. Plan con tope por agente y cupo de tenant amplio. */
const row = (over: Record<string, unknown> = {}) => ({
  isActive: true,
  tokenBalance: null,
  plan: { tokenQuotaPerAgent: 1_000 },
  tokensUsedPeriod: 0,
  periodStart: PERIOD_START,
  periodAnchorDay: 27,
  credentialMode: "platform",
  ...over,
});

/** Consumo por agente: la suma responde según el `agente_id` que se le pida. */
const consumoPorAgente = (mapa: Record<string, number>) => {
  mockAggregate.mockImplementation(async (args: { where: { agentId: string } }) => ({
    _sum: { tokens: mapa[args.where.agentId] ?? 0 },
  }));
};

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.tenant.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
  (prisma.agent.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
  mockAggregate.mockResolvedValue({ _sum: { tokens: 0 } });
});

/** Tenant gobernado por plan, sin override. Segundo argumento de `resolveAgentQuota` desde H7. */
const conPlan = (tokenQuotaPerAgent: number | null) => ({
  tokenBalance: null,
  plan: { tokenQuotaPerAgent },
});

describe("T5.1 — de dónde sale el tope de un agente", () => {
  it("el override del agente gana al plan", () => {
    expect(resolveAgentQuota({ tokenQuotaOverride: 250 }, conPlan(1_000))).toEqual({
      limit: 250,
      source: "override",
    });
  });

  it("sin override, lo dicta el plan (valor por defecto)", () => {
    expect(resolveAgentQuota({ tokenQuotaOverride: null }, conPlan(1_000))).toEqual({
      limit: 1_000,
      source: "plan",
    });
  });

  it("override `0` bloquea ESE agente, sin tocar a sus hermanos", () => {
    expect(resolveAgentQuota({ tokenQuotaOverride: 0 }, conPlan(1_000)).limit).toBe(0);
  });

  it("H7 — sin plan ni override del tenant: tope por defecto de 10M, no 'sin tope'", () => {
    // Cambio deliberado de H7. Antes esto devolvía `{limit: null, source: "none"}` porque el tenant
    // sin plan ya no llegaba aquí (lo cortaba el gate). Ahora el tenant sin plan tiene cupo por
    // defecto, así que sus agentes necesitan su propio tope: si no, un agente charlatán se come el
    // cupo de los otros dos que el cliente está pagando.
    expect(resolveAgentQuota({ tokenQuotaOverride: null }, { tokenBalance: null })).toEqual({
      limit: DEFAULT_TOKEN_QUOTA_PER_AGENT,
      source: "default",
    });
  });

  it("H7 — con override del tenant NO se aplica el defecto por agente", () => {
    // El override es un total elegido a mano, no una cifra por agente. Toparle cada agente en 10M
    // dejaría a un tenant con 50M y tres agentes en 30M utilizables: el ajuste manual deshecho solo.
    expect(resolveAgentQuota({ tokenQuotaOverride: null }, { tokenBalance: 50_000_000 })).toEqual({
      limit: null,
      source: "none",
    });
  });

  it("plan sin tope por agente tampoco pone tope al agente", () => {
    expect(resolveAgentQuota({ tokenQuotaOverride: null }, conPlan(null))).toEqual({
      limit: null,
      source: "none",
    });
  });
});

describe("T5.1 — qué se suma como consumo del agente", () => {
  it("sólo el periodo vigente y sólo modo plataforma", async () => {
    mockAggregate.mockResolvedValue({ _sum: { tokens: 400 } });

    await expect(sumAgentPeriodUsage("a1", PERIOD_START)).resolves.toBe(400);

    expect(mockAggregate).toHaveBeenCalledWith({
      where: { agentId: "a1", createdAt: { gte: PERIOD_START }, credentialMode: "platform" },
      _sum: { tokens: true },
    });
  });

  it("sin filas, cero (no `null`): el gate compara números, no huecos", async () => {
    mockAggregate.mockResolvedValue({ _sum: { tokens: null } });
    await expect(sumAgentPeriodUsage("a1", PERIOD_START)).resolves.toBe(0);
  });
});

describe("T5.1 — un agente topado no consume el cupo de sus hermanos", () => {
  it("el agente agotado se corta y el hermano sigue respondiendo", async () => {
    // Mismo tenant, mismo plan (1.000 por agente) y cupo de tenant de sobra (3 agentes ⇒ 3.000).
    mockFind.mockResolvedValue(row({ tokensUsedPeriod: 1_050 }));
    consumoPorAgente({ agotado: 1_000, hermano: 50 });

    await expect(
      checkClientBalance("t1", { id: "agotado", tokenQuotaOverride: null })
    ).rejects.toThrow(/este asistente ha alcanzado su límite/i);

    await expect(
      checkClientBalance("t1", { id: "hermano", tokenQuotaOverride: null })
    ).resolves.toBe("platform");
  });

  it("el tope del agente corta aunque el tenant tenga cupo libre", async () => {
    mockFind.mockResolvedValue(row({ tokensUsedPeriod: 1_000 }));
    consumoPorAgente({ a1: 1_000 });

    await expect(checkClientBalance("t1", { id: "a1", tokenQuotaOverride: null })).rejects
      .toMatchObject({ status: 402 });
  });

  it("justo por debajo del tope pasa (el corte es `>=`, no `>`)", async () => {
    mockFind.mockResolvedValue(row());
    consumoPorAgente({ a1: 999 });

    await expect(checkClientBalance("t1", { id: "a1", tokenQuotaOverride: null })).resolves.toBe(
      "platform"
    );
  });
});

describe("T5.2 — el 402 de agente es distinguible del de tenant", () => {
  it("agente topado ⇒ motivo de cupo de agente, NO de suspensión", async () => {
    mockFind.mockResolvedValue(row());
    consumoPorAgente({ a1: 5_000 });

    const err = await checkClientBalance("t1", { id: "a1", tokenQuotaOverride: null }).catch(
      (e) => e
    );
    expect(err.status).toBe(402);
    expect(err.message).toMatch(/este asistente ha alcanzado su límite/i);
    expect(err.message).not.toMatch(/desactivado/i);
  });

  it("tenant `isActive = false` ⇒ motivo de suspensión, y no se mira el agente", async () => {
    mockFind.mockResolvedValue(row({ isActive: false }));
    consumoPorAgente({ a1: 0 });

    const err = await checkClientBalance("t1", { id: "a1", tokenQuotaOverride: null }).catch(
      (e) => e
    );
    expect(err.message).toMatch(/desactivado/i);
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  it("tenant sin cupo ⇒ motivo de cupo de TENANT, y no se paga la suma del agente", async () => {
    // El orden importa: si el cliente está sin cupo, ese es el hecho que hay que arreglar y afecta
    // a todos sus agentes. Decir "este asistente llegó a su límite" mandaría a subir un tope que
    // no cambiaría nada.
    mockFind.mockResolvedValue(row({ tokensUsedPeriod: 3_000 }));
    consumoPorAgente({ a1: 0 });

    const err = await checkClientBalance("t1", { id: "a1", tokenQuotaOverride: null }).catch(
      (e) => e
    );
    expect(err.message).toMatch(/cupo de uso/i);
    expect(err.message).not.toMatch(/este asistente ha alcanzado/i);
    expect(mockAggregate).not.toHaveBeenCalled();
  });
});

describe("T5 — la suma sólo se paga cuando hay tope que comparar", () => {
  it("sin agente (consumo que no viene de un agente, p. ej. `crm_generate`) no se suma nada", async () => {
    mockFind.mockResolvedValue(row());

    await expect(checkClientBalance("t1")).resolves.toBe("platform");
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  it("tenant con override y sin plan: no hay tope de agente, no hay suma", async () => {
    mockFind.mockResolvedValue(row({ tokenBalance: 10_000, plan: null, tokensUsedPeriod: 10 }));

    await expect(checkClientBalance("t1", { id: "a1", tokenQuotaOverride: null })).resolves.toBe(
      "platform"
    );
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  it("byok: ni cupo de tenant ni tope de agente (el cliente paga su propio LLM)", async () => {
    mockFind.mockResolvedValue(row({ credentialMode: "byok" }));
    consumoPorAgente({ a1: 999_999 });

    await expect(checkClientBalance("t1", { id: "a1", tokenQuotaOverride: null })).resolves.toBe(
      "byok"
    );
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  it("un agente con override sí se compara aunque el plan no tenga tope", async () => {
    mockFind.mockResolvedValue(row({ plan: { tokenQuotaPerAgent: null } }));
    consumoPorAgente({ a1: 500 });

    await expect(checkClientBalance("t1", { id: "a1", tokenQuotaOverride: 400 })).rejects.toThrow(
      /alcanzado su límite/i
    );
    expect(mockAggregate).toHaveBeenCalledTimes(1);
  });
});

describe("T5 — la suma usa el periodo RENOVADO, no el vencido", () => {
  it("tras renovar, el consumo del agente se mide desde el periodo nuevo", async () => {
    // Periodo vencido: el gate renueva y el `periodStart` con el que se suma debe ser el nuevo. Si
    // se sumara desde el vencido, el agente arrastraría el consumo del mes anterior y llegaría al
    // tope sin haber gastado nada del periodo en curso.
    const vencido = new Date(PERIOD_START.getTime() - 40 * 24 * 60 * 60 * 1000);
    mockFind.mockResolvedValue(
      row({ periodStart: vencido, periodAnchorDay: vencido.getUTCDate(), tokensUsedPeriod: 900 })
    );
    consumoPorAgente({ a1: 0 });

    await checkClientBalance("t1", { id: "a1", tokenQuotaOverride: null });

    const usado = mockAggregate.mock.calls[0][0].where.createdAt.gte as Date;
    expect(usado.getTime()).toBeGreaterThan(vencido.getTime());
  });
});
