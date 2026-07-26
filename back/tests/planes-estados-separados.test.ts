/**
 * H4 (aa-planes-y-cuotas, T1) — Estado de pago y estado de cupo son hechos distintos.
 *
 * Antes de este change los dos vivían en `Tenant.isActive`:
 *  - `deductTokens` lo apagaba al agotar el cupo (sin aportar bloqueo: `checkClientBalance` ya
 *    cortaba comparando saldo contra consumo);
 *  - `PATCH /clients/:id/credits` lo volvía a encender por inferencia
 *    (`isActive ?? tokenBalance > tokensUsed`).
 * Resultado: recargar el crédito de un cliente moroso lo reactivaba, y bajarle el cupo
 * suspendía a uno que estaba al día. Con Stripe (H6) eso sería un agujero de cobro.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Gate real (checkClientBalance), prisma mockeado.
vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findUnique: vi.fn(), update: vi.fn() },
    tokenUsage: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import { checkClientBalance, deductTokens } from "@/lib/token-metering";
import { HttpError } from "@/lib/http";

const mockFind = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.tenant.update as ReturnType<typeof vi.fn>;
const mockTx = prisma.$transaction as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({});
  // La forma del resultado importa: el código eliminado leía `[client] = await $transaction(...)`
  // y decidía `if (client.isActive && client.tokensUsed >= client.tokenBalance)`. Con `{}` esa
  // condición era `undefined && …` ⇒ falsa, y el test pasaba igual CONTRA LA VERSIÓN ANTIGUA.
  // Con un tenant activo y ya pasado de cupo, la rama vieja SÍ se dispararía: el test discrimina.
  mockTx.mockResolvedValue([{ isActive: true, tokenBalance: 100, tokensUsed: 500 }, {}]);
});

describe("T1.1 — agotar el cupo no suspende la cuenta", () => {
  it("deductTokens que agota el cupo NO escribe isActive", async () => {
    await deductTokens("tenant-1", "a1", "conv-1", 500, "gpt-4o");

    // El consumo se registra en una única transacción...
    expect(mockTx).toHaveBeenCalledTimes(1);
    // ...y hay UNA sola escritura sobre el tenant (la de la propia transacción: en la forma
    // array de $transaction, Prisma construye las operaciones antes de pasarlas). Antes había
    // una segunda, fuera de la transacción, poniendo isActive = false.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "tenant-1" },
      data: { tokensUsed: { increment: 500 } },
    });
    // Ninguna escritura toca el estado administrativo.
    for (const [arg] of mockUpdate.mock.calls) {
      expect(arg.data).not.toHaveProperty("isActive");
    }
  });

  it("el cupo agotado sigue bloqueando, con isActive intacto", async () => {
    // Estado tras el consumo: activo (nadie lo suspendió) pero sin cupo.
    mockFind.mockResolvedValue({ isActive: true, tokenBalance: 100, tokensUsed: 110 });

    await expect(checkClientBalance("tenant-1")).rejects.toMatchObject({ status: 402 });
  });
});

describe("T1.3 — los dos motivos de corte se distinguen", () => {
  it("cuota agotada explica que es cupo, no suspensión", async () => {
    mockFind.mockResolvedValue({ isActive: true, tokenBalance: 100, tokensUsed: 100 });

    await expect(checkClientBalance("t")).rejects.toThrow(/cupo de uso/i);
  });

  it("cuenta suspendida explica que está desactivada, no que gastó su cuota", async () => {
    mockFind.mockResolvedValue({ isActive: false, tokenBalance: 1_000, tokensUsed: 0 });

    await expect(checkClientBalance("t")).rejects.toThrow(/desactivado/i);
  });

  it("suspendido Y sin cupo reporta la suspensión: es el hecho administrativo", async () => {
    mockFind.mockResolvedValue({ isActive: false, tokenBalance: 100, tokensUsed: 500 });

    await expect(checkClientBalance("t")).rejects.toThrow(/desactivado/i);
  });

  it("cliente borrado se trata como desactivado, sin filtrar que no existe", async () => {
    mockFind.mockResolvedValue(null);

    const err = await checkClientBalance("t").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(402);
    expect(err.message).toMatch(/desactivado/i);
  });

  it("tenant activo con cupo no lanza", async () => {
    mockFind.mockResolvedValue({ isActive: true, tokenBalance: 1_000, tokensUsed: 10 });

    await expect(checkClientBalance("t")).resolves.toBeUndefined();
  });
});
