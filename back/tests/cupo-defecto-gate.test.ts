/**
 * H7 (aa-cupo-defecto-y-avisos, T2.3) — El gate con el cupo por defecto.
 *
 * Dos cosas que fijar, y la segunda es la que sostiene el modelo de negocio:
 *
 * 1. El 402 "no tiene un plan de uso asignado" desaparece: ya no hay estado del que salga.
 * 2. Con tres agentes el tenant tiene 30M, pero **un agente charlatán no se come los 30**. Si se los
 *    comiera, el cliente estaría pagando tres agentes y usando uno.
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
import { DEFAULT_TOKEN_QUOTA_PER_AGENT } from "@/lib/quota";
import { checkClientBalance } from "@/lib/token-metering";

const mockFind = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const mockAgentCount = prisma.agent.count as ReturnType<typeof vi.fn>;
const mockAggregate = prisma.tokenUsage.aggregate as ReturnType<typeof vi.fn>;

const PERIOD_START = new Date("2026-07-27T00:00:00.000Z");

/** Tenant recién dado de alta: sin override, sin plan. El estado en el que llega un cliente nuevo. */
const nuevo = (over: Record<string, unknown> = {}) => ({
  isActive: true,
  tokenBalance: null,
  plan: null,
  tokensUsedPeriod: 0,
  periodStart: PERIOD_START,
  periodAnchorDay: 27,
  credentialMode: "platform",
  ...over,
});

const consumoPorAgente = (mapa: Record<string, number>) => {
  mockAggregate.mockImplementation(async (args: { where: { agentId: string } }) => ({
    _sum: { tokens: mapa[args.where.agentId] ?? 0 },
  }));
};

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.tenant.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
  mockAgentCount.mockResolvedValue(1);
  mockAggregate.mockResolvedValue({ _sum: { tokens: 0 } });
});

describe("T2 — AC6: el corte por 'sin plan' ya no existe", () => {
  it("un cliente nuevo atiende desde el primer mensaje", async () => {
    mockFind.mockResolvedValue(nuevo());

    await expect(checkClientBalance("t1")).resolves.toBe("platform");
  });

  it("ningún estado produce ya el mensaje de 'plan de uso'", async () => {
    const estados = [
      nuevo(),
      nuevo({ tokensUsedPeriod: DEFAULT_TOKEN_QUOTA_PER_AGENT }),
      nuevo({ tokenBalance: 0 }),
      nuevo({ isActive: false }),
    ];

    for (const estado of estados) {
      mockFind.mockResolvedValue(estado);
      const error = await checkClientBalance("t1").catch((e: Error) => e);
      if (error instanceof Error) {
        expect(error.message).not.toMatch(/plan de uso/i);
      }
    }
  });

  it("agotar el defecto corta por cupo, con el mensaje de cupo", async () => {
    mockFind.mockResolvedValue(nuevo({ tokensUsedPeriod: DEFAULT_TOKEN_QUOTA_PER_AGENT }));

    await expect(checkClientBalance("t1")).rejects.toMatchObject({ status: 402 });
    await expect(checkClientBalance("t1")).rejects.toThrow(/cupo de uso/i);
  });

  it("R1 — el bloqueo manual (`saldo = 0`) sigue cortando", async () => {
    mockFind.mockResolvedValue(nuevo({ tokenBalance: 0 }));

    await expect(checkClientBalance("t1")).rejects.toMatchObject({ status: 402 });
  });

  it("el impago sigue mandando sobre todo lo demás", async () => {
    mockFind.mockResolvedValue(nuevo({ isActive: false }));

    await expect(checkClientBalance("t1")).rejects.toThrow(/desactivado/i);
  });
});

describe("T2 — AC7 / E3: un agente no se come el cupo de sus hermanos", () => {
  it("el que agota su tope se corta y el hermano sigue respondiendo", async () => {
    // Tenant sin plan con 3 agentes: cupo de tenant 30M, tope por agente 10M.
    mockAgentCount.mockResolvedValue(3);
    consumoPorAgente({ hablador: DEFAULT_TOKEN_QUOTA_PER_AGENT, tranquilo: 100 });
    mockFind.mockResolvedValue(nuevo({ tokensUsedPeriod: DEFAULT_TOKEN_QUOTA_PER_AGENT + 100 }));

    await expect(
      checkClientBalance("t1", { id: "hablador", tokenQuotaOverride: null })
    ).rejects.toThrow(/este asistente/i);

    await expect(
      checkClientBalance("t1", { id: "tranquilo", tokenQuotaOverride: null })
    ).resolves.toBe("platform");
  });

  it("el tope del tenant se comprueba ANTES que el del agente", async () => {
    // Si el cliente está sin cupo, ese es el hecho que hay que arreglar: decirle que "este asistente
    // llegó a su límite" le mandaría a subir un tope que no cambiaría nada.
    mockAgentCount.mockResolvedValue(1);
    consumoPorAgente({ a1: DEFAULT_TOKEN_QUOTA_PER_AGENT });
    mockFind.mockResolvedValue(nuevo({ tokensUsedPeriod: DEFAULT_TOKEN_QUOTA_PER_AGENT }));

    await expect(checkClientBalance("t1", { id: "a1", tokenQuotaOverride: null })).rejects.toThrow(
      /cupo de uso/i
    );
  });

  it("el override del agente sigue ganando al defecto", async () => {
    mockAgentCount.mockResolvedValue(3);
    consumoPorAgente({ a1: 500 });
    mockFind.mockResolvedValue(nuevo());

    await expect(checkClientBalance("t1", { id: "a1", tokenQuotaOverride: 400 })).rejects.toThrow(
      /este asistente/i
    );
  });
});

describe("T2.2 — BYOK: sin cobro y sin contador, sin tocar nada", () => {
  it("no se le aplica cupo, ni se cuentan agentes, ni se suma consumo", async () => {
    mockFind.mockResolvedValue(
      nuevo({ credentialMode: "byok", tokensUsedPeriod: 999_000_000 })
    );

    await expect(
      checkClientBalance("t1", { id: "a1", tokenQuotaOverride: null })
    ).resolves.toBe("byok");
    expect(mockAgentCount).not.toHaveBeenCalled();
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  it("byok con `saldo = 0` tampoco se corta por cupo: no consume nada del propietario", async () => {
    mockFind.mockResolvedValue(nuevo({ credentialMode: "byok", tokenBalance: 0 }));

    await expect(checkClientBalance("t1")).resolves.toBe("byok");
  });

  it("byok NO dispensa del impago: traer tu clave no es dejar de ser cliente", async () => {
    mockFind.mockResolvedValue(nuevo({ credentialMode: "byok", isActive: false }));

    await expect(checkClientBalance("t1")).rejects.toThrow(/desactivado/i);
  });
});

describe("T2 — R3: coste de la consulta nueva", () => {
  it("con override no se cuentan agentes (los 15 tenants de producción)", async () => {
    mockFind.mockResolvedValue(nuevo({ tokenBalance: 10_000_000 }));

    await expect(checkClientBalance("t1")).resolves.toBe("platform");
    expect(mockAgentCount).not.toHaveBeenCalled();
  });

  it("sin override se cuenta UNA vez por mensaje, no una por agente", async () => {
    mockAgentCount.mockResolvedValue(3);
    mockFind.mockResolvedValue(nuevo());

    await checkClientBalance("t1");
    expect(mockAgentCount).toHaveBeenCalledTimes(1);
  });
});
