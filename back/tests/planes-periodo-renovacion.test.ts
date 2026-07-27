/**
 * H4 (aa-planes-y-cuotas, T3.2/T3.3) — Renovación perezosa del periodo y gate contra el contador
 * del periodo.
 *
 * Lo que este change arregla: `tokensUsed` sólo sube, así que el cupo era un saldo de prepago que
 * se agotaba y no volvía. Cobrar una suscripción mensual contra ese contador es vender algo que
 * deja de funcionar el segundo mes.
 *
 * Gate real (`checkClientBalance`) con prisma mockeado: lo que se verifica es CUÁNDO se escribe,
 * QUÉ se escribe y contra QUÉ contador se decide.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { checkClientBalance } from "@/lib/token-metering";

const mockFind = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const mockUpdateMany = prisma.tenant.updateMany as ReturnType<typeof vi.fn>;

/** Fila del tenant tal como la lee el gate. En la BD real las tres columnas del periodo son NOT NULL. */
const row = (over: Record<string, unknown> = {}) => ({
  isActive: true,
  tokenBalance: 1_000,
  tokensUsedPeriod: 0,
  periodStart: new Date(),
  periodAnchorDay: 1,
  credentialMode: "platform",
  ...over,
});

/** Fecha con `offsetDays` días de desfase respecto a ahora. */
const hace = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ count: 1 });
});

describe("T3.2 — renovación perezosa", () => {
  it("periodo VIGENTE: decide sin escribir (el gate no cuesta un UPDATE por mensaje)", async () => {
    mockFind.mockResolvedValue(row({ periodStart: hace(3), tokensUsedPeriod: 500 }));

    await expect(checkClientBalance("t1")).resolves.toBe("platform");

    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("periodo VENCIDO: renueva el ancla y pone el contador a cero", async () => {
    const periodStart = hace(40);
    mockFind.mockResolvedValue(row({ periodStart, periodAnchorDay: periodStart.getUTCDate() }));

    await checkClientBalance("t1");

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const arg = mockUpdateMany.mock.calls[0][0];
    // El WHERE lleva el `periodStart` que se leyó: es un compare-and-set, no un UPDATE ciego.
    expect(arg.where).toEqual({ id: "t1", periodStart });
    expect(arg.data.tokensUsedPeriod).toBe(0);
    expect(arg.data.periodStart.getTime()).toBeGreaterThan(periodStart.getTime());
  });

  it("cupo agotado en el periodo anterior: al renovar vuelve a atender", async () => {
    // Este es el defecto que T3 cierra. Con el contador de por vida, este cliente estaba cortado
    // para siempre por lo que gastó el mes pasado.
    const periodStart = hace(40);
    mockFind.mockResolvedValue(
      row({
        periodStart,
        periodAnchorDay: periodStart.getUTCDate(),
        tokenBalance: 1_000,
        tokensUsedPeriod: 1_000,
      })
    );

    await expect(checkClientBalance("t1")).resolves.toBe("platform");
  });

  it("byok también renueva: un cambio de modo no debe traer el periodo de hace meses", async () => {
    // En byok el cupo no corta, pero el contador tiene que quedar coherente. Si sólo se renovara
    // en 'platform', al volver a 'platform' llegaría con el contador viejo y cortaría al primer
    // mensaje por consumo que ya no le corresponde.
    const periodStart = hace(70);
    mockFind.mockResolvedValue(
      row({
        periodStart,
        periodAnchorDay: periodStart.getUTCDate(),
        credentialMode: "byok",
        tokensUsedPeriod: 99_999,
      })
    );

    await expect(checkClientBalance("t1")).resolves.toBe("byok");
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("carrera: quien pierde el compare-and-set relee y NO asume cero", async () => {
    // Dos peticiones simultáneas con el periodo vencido. La que pierde no puede dar por cero el
    // contador ajeno: entre la renovación de la otra y esta lectura ya pudo haber consumo, y
    // asumir cero regalaría un mensaje por carrera.
    const periodStart = hace(40);
    mockFind
      .mockResolvedValueOnce(row({ periodStart, periodAnchorDay: periodStart.getUTCDate(), tokenBalance: 100 }))
      .mockResolvedValueOnce({ tokensUsedPeriod: 100 });
    mockUpdateMany.mockResolvedValue({ count: 0 }); // otra petición renovó primero

    await expect(checkClientBalance("t1")).rejects.toMatchObject({ status: 402 });
    // Releyó en lugar de continuar con su propia suposición.
    expect(mockFind).toHaveBeenCalledTimes(2);
  });

  it("carrera con cupo libre tras releer: pasa con el contador ajeno, no con el suyo", async () => {
    const periodStart = hace(40);
    mockFind
      .mockResolvedValueOnce(row({ periodStart, periodAnchorDay: periodStart.getUTCDate(), tokenBalance: 100 }))
      .mockResolvedValueOnce({ tokensUsedPeriod: 20 });
    mockUpdateMany.mockResolvedValue({ count: 0 });

    await expect(checkClientBalance("t1")).resolves.toBe("platform");
  });
});

describe("T3.3 — el gate corta por el contador del PERIODO", () => {
  it("cupo agotado dentro del periodo vigente: 402 con motivo de cupo", async () => {
    mockFind.mockResolvedValue(
      row({ periodStart: hace(2), tokenBalance: 500, tokensUsedPeriod: 500 })
    );

    await expect(checkClientBalance("t1")).rejects.toThrow(/cupo de uso/i);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("periodo a cero atiende aunque el acumulado de por vida sea enorme", async () => {
    // `tokensUsed` es histórico y no entra en la decisión. Si entrara, el cupo seguiría siendo un
    // prepago con otro nombre.
    mockFind.mockResolvedValue(
      row({ periodStart: hace(1), tokenBalance: 1_000, tokensUsed: 50_000_000, tokensUsedPeriod: 0 })
    );

    await expect(checkClientBalance("t1")).resolves.toBe("platform");
  });

  it("impago (isActive=false) corta ANTES de renovar: no se toca el periodo de un suspendido", async () => {
    mockFind.mockResolvedValue(row({ isActive: false, periodStart: hace(40) }));

    await expect(checkClientBalance("t1")).rejects.toThrow(/desactivado/i);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
