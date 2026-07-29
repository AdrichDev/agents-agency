/**
 * aa-cupo-cache-y-prefijo — T2.4.
 *
 * `chargeableTokens` ya está probada aparte. Lo que se prueba aquí es que el resultado LLEGA a los
 * tres sitios que deciden cuánto le queda al cliente, y que el bruto no se pierde por el camino:
 *
 *  - `tenant.tokensUsedPeriod`, contra el que corta el gate.
 *  - `tenant.tokensUsed`, el acumulado de por vida.
 *  - `uso_tokens.tokens`, que `sumAgentPeriodUsage` suma para el tope POR AGENTE.
 *
 * Si los tres no llevan el MISMO número, los dos topes miden cosas distintas y el del agente corta
 * antes que el del tenant sin ningún motivo económico.
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
import { deductTokens } from "@/lib/token-metering";

const mockUpdate = prisma.tenant.update as ReturnType<typeof vi.fn>;
const mockUsageCreate = prisma.tokenUsage.create as ReturnType<typeof vi.fn>;
const mockTx = prisma.$transaction as ReturnType<typeof vi.fn>;

/** Desglose tal como lo emite `runToolLoop`: 3000 totales con 1000 servidos de caché. */
const DESGLOSE = { promptTokens: 2500, cachedTokens: 1000, iterations: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockReturnValue({ __op: "tenant.update" });
  mockUsageCreate.mockReturnValue({ __op: "tokenUsage.create" });
  mockTx.mockResolvedValue([]);
});

describe("AC5 — los contadores y la fila guardan el MISMO imputado", () => {
  it("platform con caché: los dos contadores del tenant suben lo imputado, no el bruto", async () => {
    await deductTokens("t1", "a1", "c1", 3000, "gpt-5.4-mini", undefined, "platform", DESGLOSE);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { tokensUsed: { increment: 2100 }, tokensUsedPeriod: { increment: 2100 } },
    });
  });

  it("uso_tokens.tokens lleva el mismo 2100 que los contadores", async () => {
    await deductTokens("t1", "a1", "c1", 3000, "gpt-5.4-mini", undefined, "platform", DESGLOSE);

    expect(mockUsageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ tokens: 2100 }),
    });
  });

  it("sigue siendo una sola transacción: cobrar sin registrar dejaría el cupo bajando sin apunte", async () => {
    await deductTokens("t1", "a1", "c1", 3000, "gpt-5.4-mini", undefined, "platform", DESGLOSE);

    expect(mockTx).toHaveBeenCalledTimes(1);
    expect(mockTx.mock.calls[0][0]).toHaveLength(2);
  });
});

describe("AC4 — el bruto no se pierde", () => {
  it("la fila guarda tokensBrutos junto al desglose que ya llevaba", async () => {
    await deductTokens("t1", "a1", "c1", 3000, "gpt-5.4-mini", undefined, "platform", DESGLOSE);

    expect(mockUsageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokens: 2100,
        contexto: { promptTokens: 2500, cachedTokens: 1000, iterations: 1, tokensBrutos: 3000 },
      }),
    });
  });

  it("un modelo sin ratio no pondera, pero la fila sigue diciendo cuál era el bruto", async () => {
    // Sin `tokensBrutos` habría que deducir de la ausencia de ponderación que bruto = imputado, y
    // eso obliga a conocer la tabla de ratios para leer una fila.
    await deductTokens("t1", "a1", "c1", 3000, "gemini-3.5-flash", undefined, "platform", DESGLOSE);

    expect(mockUsageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokens: 3000,
        contexto: expect.objectContaining({ tokensBrutos: 3000 }),
      }),
    });
  });

  it("un llamador sin desglose (crm_generate) no cambia de forma: sin contexto, sin campo", async () => {
    // Retrocompatibilidad explícita: `contexto` es opcional y añadir `tokensBrutos` a secas
    // metería un JSON en filas que hoy no lo tienen, cambiando la forma de datos por nada.
    await deductTokens("t1", "a1", "c1", 500, "gpt-4o", "crm_generate", "platform");

    const data = mockUsageCreate.mock.calls[0][0].data;
    expect(data.tokens).toBe(500);
    expect(data).not.toHaveProperty("contexto");
  });
});

describe("AC6 — byok registra igual y sigue sin tocar contadores", () => {
  it("la fila byok lleva imputado y bruto, como en platform", async () => {
    // Si sólo se ponderara una de las dos ramas, las filas de un mismo tenant significarían cosas
    // distintas según el modo en que estaba ese día, y su histórico dejaría de ser comparable.
    await deductTokens("t1", "a1", "c1", 3000, "gpt-5.4-mini", undefined, "byok", DESGLOSE);

    expect(mockUsageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokens: 2100,
        credentialMode: "byok",
        contexto: expect.objectContaining({ tokensBrutos: 3000, cachedTokens: 1000 }),
      }),
    });
  });

  it("byok no incrementa nada (regresión H2)", async () => {
    await deductTokens("t1", "a1", "c1", 3000, "gpt-5.4-mini", undefined, "byok", DESGLOSE);

    expect(mockTx).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("AC3 en el punto de descuento — sin datos de caché nada cambia", () => {
  it("sin cachedTokens informado se imputa el bruto (regresión: comportamiento previo)", async () => {
    await deductTokens("t1", "a1", "c1", 3000, "gpt-5.4-mini", undefined, "platform", {
      promptTokens: 2500,
      cachedTokens: null,
      iterations: 1,
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { tokensUsed: { increment: 3000 }, tokensUsedPeriod: { increment: 3000 } },
    });
  });
});

describe("T2.3 — la guarda de cero opera sobre el BRUTO", () => {
  it("bruto 0: no escribe fila, como siempre", async () => {
    await deductTokens("t1", "a1", "c1", 0, "gpt-5.4-mini", undefined, "platform", DESGLOSE);

    expect(mockUsageCreate).not.toHaveBeenCalled();
    expect(mockTx).not.toHaveBeenCalled();
  });

  it("un turno casi entero de caché SÍ deja fila aunque lo imputado sea mínimo", async () => {
    // Este es el turno que el change persigue, y es justo el que una guarda sobre el imputado
    // borraría del histórico. 1150 − 1140*0,9 = 124.
    await deductTokens("t1", "a1", "c1", 1150, "gpt-5.4-mini", undefined, "platform", {
      promptTokens: 1145,
      cachedTokens: 1140,
      iterations: 1,
    });

    expect(mockUsageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ tokens: 124, contexto: expect.objectContaining({ tokensBrutos: 1150 }) }),
    });
  });
});
