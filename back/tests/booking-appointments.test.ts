/**
 * Helpers de booking reusables (aa-managed-db-conexion-compartida F1):
 * `computeAvailableSlots`, `createAppointment`, `cancelAppointment`. Estos helpers
 * extraen la logica que antes vivia inline en `routes/booking.ts` para que el
 * router HTTP y el adapter `managed_db` compartan el mismo camino.
 *
 * Tests herméticos: se mockea `@/lib/db` (prisma), `@/lib/booking/slots`
 * (generateSlots puro) y `@/lib/booking/sync` (GCal best-effort).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const txMock = {
  timeSlot: { create: vi.fn() },
  appointment: { create: vi.fn() },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    service: { findUnique: vi.fn() },
    blockedRange: { findMany: vi.fn() },
    timeSlot: { findMany: vi.fn(), update: vi.fn() },
    appointment: { findUnique: vi.fn(), update: vi.fn() },
    integration: { findFirst: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: typeof txMock) => Promise<unknown>)(txMock);
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
  },
}));

vi.mock("@/lib/booking/slots", () => ({ generateSlots: vi.fn() }));
vi.mock("@/lib/booking/sync", () => ({
  syncAppointmentToGcal: vi.fn(),
  unsyncAppointmentFromGcal: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { generateSlots } from "@/lib/booking/slots";
import { syncAppointmentToGcal, unsyncAppointmentFromGcal } from "@/lib/booking/sync";
import {
  computeAvailableSlots,
  createAppointment,
  cancelAppointment,
  ServiceNotFoundError,
  ScheduleNotConfiguredError,
  SlotUnavailableError,
  AppointmentNotFoundError,
  AppointmentAlreadyCancelledError,
} from "@/lib/booking/appointments";

const mServiceFindUnique = prisma.service.findUnique as ReturnType<typeof vi.fn>;
const mBlockedFindMany = prisma.blockedRange.findMany as ReturnType<typeof vi.fn>;
const mSlotFindMany = prisma.timeSlot.findMany as ReturnType<typeof vi.fn>;
const mApptFindUnique = prisma.appointment.findUnique as ReturnType<typeof vi.fn>;
const mIntegrationFindFirst = prisma.integration.findFirst as ReturnType<typeof vi.fn>;
const mGenerateSlots = generateSlots as ReturnType<typeof vi.fn>;
const mSync = syncAppointmentToGcal as ReturnType<typeof vi.fn>;
const mUnsync = unsyncAppointmentFromGcal as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

const RANGO = {
  desde: new Date("2026-07-20T00:00:00.000Z"),
  hasta: new Date("2026-07-20T23:59:59.000Z"),
};
const SLOT_A = { startTime: "2026-07-20T09:00:00.000Z", endTime: "2026-07-20T09:30:00.000Z" };
const SLOT_B = { startTime: "2026-07-20T10:00:00.000Z", endTime: "2026-07-20T10:30:00.000Z" };

// ── computeAvailableSlots ───────────────────────────────────────────────────
describe("computeAvailableSlots", () => {
  it("genera slots teoricos y resta las franjas ya reservadas", async () => {
    mServiceFindUnique.mockResolvedValue({
      id: "svc-1",
      duration: 30,
      agent: {
        schedule: { id: "sch-1", timezone: "Europe/Madrid", schedule: { monday: "09:00-18:00" } },
      },
    });
    mBlockedFindMany.mockResolvedValue([]);
    mGenerateSlots.mockReturnValue([SLOT_A, SLOT_B]);
    // SLOT_A ya reservado (disponible=false)
    mSlotFindMany.mockResolvedValue([{ startTime: new Date(SLOT_A.startTime) }]);

    const slots = await computeAvailableSlots("svc-1", RANGO);

    expect(mGenerateSlots).toHaveBeenCalledWith(
      RANGO.desde,
      RANGO.hasta,
      30,
      { monday: "09:00-18:00" },
      "Europe/Madrid",
      []
    );
    expect(mSlotFindMany).toHaveBeenCalledWith({
      where: { serviceId: "svc-1", available: false },
      select: { startTime: true },
    });
    expect(slots).toEqual([SLOT_B]);
  });

  it("lanza ServiceNotFoundError si no existe el servicio", async () => {
    mServiceFindUnique.mockResolvedValue(null);
    await expect(computeAvailableSlots("nope", RANGO)).rejects.toBeInstanceOf(ServiceNotFoundError);
  });

  it("lanza ScheduleNotConfiguredError si el agente no tiene horario", async () => {
    mServiceFindUnique.mockResolvedValue({ id: "svc-1", duration: 30, agent: { schedule: null } });
    await expect(computeAvailableSlots("svc-1", RANGO)).rejects.toBeInstanceOf(
      ScheduleNotConfiguredError
    );
  });
});

// ── createAppointment ───────────────────────────────────────────────────────
describe("createAppointment", () => {
  const start = new Date(SLOT_A.startTime);
  const end = new Date(SLOT_A.endTime);

  it("crea franja + cita en transaccion y devuelve el resultado mapeado", async () => {
    txMock.timeSlot.create.mockResolvedValue({ id: "fr-1", startTime: start, endTime: end });
    txMock.appointment.create.mockResolvedValue({
      id: "cita-1",
      service: { id: "svc-1", name: "Corte", agentId: "agent-1" },
    });
    mIntegrationFindFirst.mockResolvedValue(null); // sin GCal

    const res = await createAppointment({
      serviceId: "svc-1",
      slotStart: start,
      slotEnd: end,
      email: "ana@example.com",
      phone: "600",
      notes: "Cliente: Ana",
    });

    expect(txMock.timeSlot.create).toHaveBeenCalledWith({
      data: { serviceId: "svc-1", startTime: start, endTime: end, available: false },
    });
    expect(res).toEqual({
      appointmentId: "cita-1",
      slotId: "fr-1",
      startTime: start,
      endTime: end,
      service: { id: "svc-1", name: "Corte", agentId: "agent-1" },
    });
    expect(mSync).not.toHaveBeenCalled();
  });

  it("sincroniza GCal best-effort si hay integracion google", async () => {
    txMock.timeSlot.create.mockResolvedValue({ id: "fr-1", startTime: start, endTime: end });
    txMock.appointment.create.mockResolvedValue({
      id: "cita-1",
      service: { id: "svc-1", name: "Corte", agentId: "agent-1" },
    });
    mIntegrationFindFirst.mockResolvedValue({ id: "int-1", provider: "google", metadata: {} });
    mSync.mockResolvedValue("evt-1");

    await createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end });
    expect(mSync).toHaveBeenCalled();
  });

  it("traduce el choque de unique (P2002) a SlotUnavailableError", async () => {
    txMock.timeSlot.create.mockRejectedValue({ code: "P2002" });
    await expect(
      createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end })
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });
});

// ── cancelAppointment ───────────────────────────────────────────────────────
describe("cancelAppointment", () => {
  it("libera la franja + marca la cita cancelada", async () => {
    mApptFindUnique.mockResolvedValue({
      id: "cita-1",
      slotId: "fr-1",
      status: "scheduled",
      gcalEventId: null,
      service: { agentId: "agent-1", agent: {} },
    });

    const res = await cancelAppointment("cita-1");
    expect(res).toEqual({ ok: true, estado: "cancelled" });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("desincroniza GCal si la cita tenia gcalEventId", async () => {
    mApptFindUnique.mockResolvedValue({
      id: "cita-1",
      slotId: "fr-1",
      status: "scheduled",
      gcalEventId: "evt-1",
      service: { agentId: "agent-1", agent: {} },
    });
    mIntegrationFindFirst.mockResolvedValue({ id: "int-1", provider: "google", metadata: {} });
    mUnsync.mockResolvedValue(true);

    await cancelAppointment("cita-1");
    expect(mUnsync).toHaveBeenCalledWith(expect.anything(), "evt-1");
  });

  it("lanza AppointmentNotFoundError si no existe", async () => {
    mApptFindUnique.mockResolvedValue(null);
    await expect(cancelAppointment("nope")).rejects.toBeInstanceOf(AppointmentNotFoundError);
  });

  it("lanza AppointmentAlreadyCancelledError si ya estaba cancelada", async () => {
    mApptFindUnique.mockResolvedValue({
      id: "cita-1",
      slotId: "fr-1",
      status: "cancelled",
      gcalEventId: null,
      service: { agentId: "agent-1", agent: {} },
    });
    await expect(cancelAppointment("cita-1")).rejects.toBeInstanceOf(
      AppointmentAlreadyCancelledError
    );
  });
});
