/**
 * H2 (aa-credenciales-byok-multiproveedor) — T5.
 *
 * En modo `byok` el cliente paga su propio LLM, así que el cupo de tokens **no le aplica**. Dos
 * errores simétricos que hay que descartar, y ninguno de los dos daría un error visible:
 *
 *  - Descontar el consumo BYOK de un cupo que no aplica → la factura del cliente sale mal y su
 *    agente deja de responder al "agotar" un cupo imaginario.
 *  - Eximir de MÁS de lo que hay que eximir: `byok` exime del CUPO, nunca de `isActive`.
 *    `isActive` es el corte por impago de la suscripción; traer tu propia clave no es dejar de
 *    ser cliente. Si eximiera, BYOK sería la vía para seguir siendo atendido sin pagar.
 *
 * Y el consumo se sigue REGISTRANDO en `uso_tokens` con su modo: sin la fila no hay forma de
 * saber cuánto gasta un cliente BYOK, que es justo el dato para negociar su precio.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findUnique: vi.fn(), update: vi.fn(() => ({ __op: "tenant.update" })) },
    tokenUsage: { create: vi.fn(() => ({ __op: "tokenUsage.create" })) },
    $transaction: vi.fn(async () => []),
  },
}));

import { prisma } from "@/lib/db";
import { checkClientBalance, assertUsageAllowed, deductTokens } from "@/lib/token-metering";

const mockFind = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.tenant.update as ReturnType<typeof vi.fn>;
const mockUsageCreate = prisma.tokenUsage.create as ReturnType<typeof vi.fn>;
const mockTx = prisma.$transaction as ReturnType<typeof vi.fn>;

/** Tenant activo, con cupo libre, en el modo por defecto. */
function tenant(over: Record<string, unknown> = {}) {
  return { isActive: true, tokenBalance: 1000, tokensUsed: 10, tokensUsedPeriod: 10, periodStart: new Date(), periodAnchorDay: 1, credentialMode: "platform", ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFind.mockResolvedValue(tenant());
  mockUpdate.mockReturnValue({ __op: "tenant.update" });
  mockUsageCreate.mockReturnValue({ __op: "tokenUsage.create" });
  mockTx.mockResolvedValue([]);
});

describe("T5.1 — el gate devuelve el modo con el que autoriza", () => {
  it("checkClientBalance devuelve credentialMode, no solo pasa o corta", async () => {
    // Una lectura, dos respuestas: si el modo se leyera después y por separado, podría diferir
    // del que autorizó el paso (clave cambiada entre las dos consultas) y se cobraría distinto
    // de como se sirvió.
    mockFind.mockResolvedValue(tenant({ credentialMode: "byok" }));

    await expect(checkClientBalance("t1")).resolves.toBe("byok");
    expect(mockFind).toHaveBeenCalledTimes(1);
  });

  it("assertUsageAllowed propaga el modo junto al tenant facturable", async () => {
    mockFind.mockResolvedValue(tenant({ credentialMode: "byok" }));

    await expect(assertUsageAllowed("t1")).resolves.toEqual({
      meteredTenantId: "t1",
      credentialMode: "byok",
    });
  });

  it("agente de prueba sin tenant: no hay a quién cobrar, modo platform por defecto", async () => {
    await expect(assertUsageAllowed(null, { isTest: true })).resolves.toEqual({
      meteredTenantId: null,
      credentialMode: "platform",
    });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("agente sin tenant fuera de pruebas sigue cortando (regresión H1)", async () => {
    await expect(assertUsageAllowed(null)).rejects.toMatchObject({ status: 402 });
  });
});

describe("T5.2 — byok exime del CUPO", () => {
  it("cupo agotado en byok: se sirve igual, el cupo no es su límite", async () => {
    mockFind.mockResolvedValue(
      tenant({ credentialMode: "byok", tokenBalance: 100, tokensUsed: 5000, tokensUsedPeriod: 5000, periodStart: new Date(), periodAnchorDay: 1 })
    );

    await expect(checkClientBalance("t1")).resolves.toBe("byok");
  });

  it("cupo a cero en byok tampoco corta", async () => {
    mockFind.mockResolvedValue(tenant({ credentialMode: "byok", tokenBalance: 0, tokensUsed: 0, tokensUsedPeriod: 0, periodStart: new Date(), periodAnchorDay: 1 }));

    await expect(checkClientBalance("t1")).resolves.toBe("byok");
  });

  it("en platform el cupo sigue cortando exactamente igual que en H1", async () => {
    mockFind.mockResolvedValue(tenant({ tokenBalance: 100, tokensUsed: 100, tokensUsedPeriod: 100, periodStart: new Date(), periodAnchorDay: 1 }));

    await expect(checkClientBalance("t1")).rejects.toMatchObject({ status: 402 });
  });
});

describe("T5.2 — byok NO exime de isActive", () => {
  it("tenant suspendido en modo byok: cortado igual (402)", async () => {
    // El agujero que este test cierra: si `byok` saltara este corte, cualquier cliente que
    // dejara de pagar la suscripción seguiría atendido sin más que pegar su propia clave.
    mockFind.mockResolvedValue(tenant({ credentialMode: "byok", isActive: false }));

    await expect(checkClientBalance("t1")).rejects.toMatchObject({ status: 402 });
  });

  it("suspendido en byok con cupo de sobra tampoco pasa: el corte es la suscripción", async () => {
    mockFind.mockResolvedValue(
      tenant({ credentialMode: "byok", isActive: false, tokenBalance: 99999, tokensUsed: 0, tokensUsedPeriod: 0, periodStart: new Date(), periodAnchorDay: 1 })
    );

    await expect(checkClientBalance("t1")).rejects.toMatchObject({ status: 402 });
  });

  it("tenant inexistente: fail-closed en los dos modos (regresión H1)", async () => {
    mockFind.mockResolvedValue(null);

    await expect(checkClientBalance("fantasma")).rejects.toMatchObject({ status: 402 });
  });
});

describe("T5.5 — deductTokens registra el consumo en los dos modos, descuenta en uno", () => {
  it("byok: escribe uso_tokens con su modo y NO incrementa tokensUsed", async () => {
    await deductTokens("t1", "a1", "conv-1", 500, "claude-opus-5", undefined, "byok");

    expect(mockUsageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "t1",
        agentId: "a1",
        conversationId: "conv-1",
        tokens: 500,
        model: "claude-opus-5",
        credentialMode: "byok",
      }),
    });
    // Ni transacción ni update del cupo: no hay nada que descontar.
    expect(mockTx).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("platform: incrementa tokensUsed y registra, en la MISMA transacción", async () => {
    await deductTokens("t1", "a1", "conv-1", 500, "gpt-4o", undefined, "platform");

    expect(mockTx).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      // H4 T3.3 — los dos contadores en la misma transacción: el de por vida y el del periodo,
      // que es contra el que corta el gate.
      data: { tokensUsed: { increment: 500 }, tokensUsedPeriod: { increment: 500 } },
    });
    // Atómico a propósito: cobrar sin registrar dejaría un cupo que baja sin explicación.
    expect(mockTx.mock.calls[0][0]).toHaveLength(2);
  });

  it("sin modo explícito asume platform: el comportamiento previo a H2 no cambia", async () => {
    await deductTokens("t1", "a1", "conv-1", 500, "gpt-4o");

    expect(mockTx).toHaveBeenCalledTimes(1);
    expect(mockUsageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ credentialMode: "platform" }),
    });
  });

  it("el modo se GUARDA en la fila: dos hechos en un solo campo darían una factura falsa", async () => {
    // La alternativa descartada era un booleano `countsAgainstQuota`: guarda la consecuencia y
    // pierde el hecho. Con el modo guardado se puede recalcular el pasado si la política cambia.
    await deductTokens("t1", "a1", null, 10, "gpt-4o", "automation", "byok");

    expect(mockUsageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ operacion: "automation", credentialMode: "byok" }),
    });
  });

  it("cero tokens: no escribe fila en ningún modo", async () => {
    await deductTokens("t1", "a1", "conv-1", 0, "gpt-4o", undefined, "byok");
    await deductTokens("t1", "a1", "conv-1", 0, "gpt-4o", undefined, "platform");

    expect(mockUsageCreate).not.toHaveBeenCalled();
    expect(mockTx).not.toHaveBeenCalled();
  });

  it("un fallo al registrar no tumba la respuesta ya servida (regresión H1)", async () => {
    // El consumo ya ocurrió: reventar aquí perdería la respuesta del usuario además del apunte.
    mockUsageCreate.mockImplementation(() => {
      throw new Error("BD caída");
    });

    await expect(
      deductTokens("t1", "a1", "conv-1", 500, "claude-opus-5", undefined, "byok")
    ).resolves.toBeUndefined();
  });
});
