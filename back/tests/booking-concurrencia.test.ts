/**
 * Dos reservas simultaneas por el ULTIMO recurso elegible
 * (aa-reservas-multirecurso-y-mocks-sectoriales, bloque E: T5.3).
 *
 * `booking-multirecurso.test.ts` ya fija que un `P2002` se traduce a `SlotUnavailableError`,
 * pero lo hace sobre un `txMock` con una sola mesa cableada a mano. Aqui la carrera corre
 * contra la tabla en memoria compartida, que respeta el unique `(recurso_id, inicio)`: las dos
 * peticiones ven el hueco libre, las dos pasan por `computeAvailableSlots` y `pickBestFit`, y
 * las dos apuntan al MISMO recurso porque es el unico que admite al grupo. Es la unica forma
 * de afirmar que el inventario se agota bien y no que el mock devuelve lo que se le pidio.
 *
 * El inventario del helper: `m1` (1-2 comensales) y `m2` (3-6). Para un grupo de 2, `m1` es el
 * unico elegible — el "ultimo recurso" del enunciado.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { facade } = await import("./helpers/booking-db-memoria");
  return { prisma: facade };
});

// GCal fuera: la sincronizacion es best-effort y post-transaccion, no es lo que se afirma.
vi.mock("@/lib/booking/sync", () => ({
  syncAppointmentToGcal: vi.fn(async () => undefined),
  unsyncAppointmentFromGcal: vi.fn(async () => undefined),
}));

import { createAppointment, SlotUnavailableError } from "@/lib/booking/appointments";
import { db, resetDb } from "./helpers/booking-db-memoria";

// 2026-08-04 es martes; 19:00Z son las 21:00 en Madrid, dentro de `tue: "13:00-23:00"`.
const INICIO = new Date("2026-08-04T19:00:00.000Z");
const FIN = new Date("2026-08-04T19:30:00.000Z");

function reservar(partySize: number) {
  return createAppointment({
    serviceId: "svc-1",
    slotStart: INICIO,
    slotEnd: FIN,
    partySize,
    email: `g${partySize}@example.com`,
  });
}

describe("T5.3 — dos reservas simultaneas por el ultimo recurso elegible", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
  });

  it("una gana y la otra recibe SlotUnavailableError", async () => {
    const [a, b] = await Promise.allSettled([reservar(2), reservar(2)]);

    const ok = [a, b].filter((r) => r.status === "fulfilled");
    const ko = [a, b].filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(ko[0].reason).toBeInstanceOf(SlotUnavailableError);
  });

  it("la perdedora no deja rastro: una sola franja y una sola cita", async () => {
    await Promise.allSettled([reservar(2), reservar(2)]);

    expect(db.slots).toHaveLength(1);
    expect(db.slots[0].resourceId).toBe("m1");
    expect(db.citas).toHaveLength(1);
  });

  it("la mesa grande sigue libre: perder la carrera no la degrada a un grupo que no la llena", async () => {
    await Promise.allSettled([reservar(2), reservar(2)]);

    // `m2` admite 3-6. Que la segunda pareja se quedase fuera no puede haberla sentado alli:
    // seria vender una mesa de seis a dos personas en el turno de mayor demanda.
    expect(db.slots.some((s) => s.resourceId === "m2")).toBe(false);

    // Y sigue disponible para quien si la llena.
    const grupo = await reservar(4);
    expect(grupo.resource.id).toBe("m2");
    expect(db.slots).toHaveLength(2);
  });
});
