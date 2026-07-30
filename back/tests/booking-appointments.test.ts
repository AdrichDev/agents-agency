/**
 * Helpers de booking reusables (aa-managed-db-conexion-compartida F1):
 * `computeAvailableSlots`, `createAppointment`, `cancelAppointment`. Estos helpers
 * extraen la logica que antes vivia inline en `routes/booking.ts` para que el
 * router HTTP y el adapter `managed_db` compartan el mismo camino.
 *
 * Tests herméticos: se mockea `@/lib/db` (prisma), `@/lib/booking/slots`
 * (generateSlots puro) y `@/lib/booking/sync` (GCal best-effort).
 *
 * Este fichero cubre el camino de UN SOLO recurso — el de un agente que no declara
 * inventario, que es como se comportaba TODO el producto antes de
 * `aa-reservas-multirecurso-y-mocks-sectoriales`. La elegibilidad por capacidad, el
 * solapamiento con buffer y el best fit viven en `booking-multirecurso.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// El tx expone tambien las LECTURAS: `createAppointment` valida el slot contra
// `computeAvailableSlots` leyendo por `tx`, dentro de la misma transaccion Serializable.
// `resource` y `serviceResource` estan aqui porque la franja necesita un recurso: cuando el
// agente no declara inventario, `ensureImplicitResource` crea uno dentro de la transaccion.
const txMock = {
  timeSlot: { create: vi.fn(), findMany: vi.fn() },
  appointment: { create: vi.fn() },
  service: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  blockedRange: { findMany: vi.fn() },
  resource: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  serviceResource: { createMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    service: { findUnique: vi.fn() },
    blockedRange: { findMany: vi.fn() },
    timeSlot: { findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
    appointment: { findUnique: vi.fn(), update: vi.fn() },
    resource: { findMany: vi.fn() },
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
const mSlotDelete = prisma.timeSlot.delete as ReturnType<typeof vi.fn>;
const mResourceFindMany = prisma.resource.findMany as ReturnType<typeof vi.fn>;
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

/**
 * Servicio de un agente SIN inventario declarado: `resources` vacio y `resource.findMany`
 * devolviendo nada, que es lo que hace caer al camino de unidad implicita.
 */
function servicioSinInventario(over: Record<string, unknown> = {}) {
  return {
    id: "svc-1",
    agentId: "agent-1",
    duration: 30,
    slotStepMin: 30,
    bufferMin: 0,
    maxPartySize: 1,
    schedule: null,
    resources: [],
    agent: {
      schedule: { id: "sch-1", timezone: "Europe/Madrid", schedule: { mon: "09:00-18:00" } },
    },
    ...over,
  };
}

// ── computeAvailableSlots ───────────────────────────────────────────────────
describe("computeAvailableSlots", () => {
  it("genera slots teoricos y resta las franjas ya reservadas", async () => {
    mServiceFindUnique.mockResolvedValue(servicioSinInventario());
    mBlockedFindMany.mockResolvedValue([]);
    mResourceFindMany.mockResolvedValue([]);
    mGenerateSlots.mockReturnValue([SLOT_A, SLOT_B]);
    // SLOT_A ya reservado (disponible=false)
    mSlotFindMany.mockResolvedValue([{ startTime: new Date(SLOT_A.startTime) }]);

    const slots = await computeAvailableSlots("svc-1", RANGO);

    // El 7º argumento es `slotStepMin`: un restaurante ofrece mesa cada 15 min con turnos de
    // 105, asi que la rejilla dejo de ir atada a la duracion del servicio.
    expect(mGenerateSlots).toHaveBeenCalledWith(
      RANGO.desde,
      RANGO.hasta,
      30,
      { mon: "09:00-18:00" },
      "Europe/Madrid",
      [],
      30
    );
    expect(mSlotFindMany).toHaveBeenCalledWith({
      where: { serviceId: "svc-1", available: false },
      select: { startTime: true },
    });
    expect(slots).toEqual([SLOT_B]);
  });

  it("resta la franja reservada aunque el slot venga con offset local (no en UTC)", async () => {
    // `generateSlots` emite el ISO de luxon CON offset; la franja guardada es un `Date`. Al
    // cotejarlos como texto no casaban nunca, asi que la disponibilidad seguia ofreciendo
    // huecos ya reservados: medido contra el agente real, el modelo pedia una y otra vez el
    // mismo hueco ocupado. El fixture anterior, en Z, no distinguia los dos casos.
    const conOffset = { startTime: "2026-07-20T11:00:00.000+02:00", endTime: "2026-07-20T11:30:00.000+02:00" };
    mServiceFindUnique.mockResolvedValue(servicioSinInventario());
    mBlockedFindMany.mockResolvedValue([]);
    mResourceFindMany.mockResolvedValue([]);
    mGenerateSlots.mockReturnValue([conOffset, SLOT_B]);
    mSlotFindMany.mockResolvedValue([{ startTime: new Date(conOffset.startTime) }]);

    expect(await computeAvailableSlots("svc-1", RANGO)).toEqual([SLOT_B]);
  });

  it("lanza ServiceNotFoundError si no existe el servicio", async () => {
    mServiceFindUnique.mockResolvedValue(null);
    await expect(computeAvailableSlots("nope", RANGO)).rejects.toBeInstanceOf(ServiceNotFoundError);
  });

  it("lanza ScheduleNotConfiguredError si el agente no tiene horario", async () => {
    mServiceFindUnique.mockResolvedValue(servicioSinInventario({ agent: { schedule: null } }));
    await expect(computeAvailableSlots("svc-1", RANGO)).rejects.toBeInstanceOf(
      ScheduleNotConfiguredError
    );
  });

  // ── Regresion de la migracion multi-recurso (T5.6) ──
  it("un agente sin recursos se comporta EXACTAMENTE como antes de la migracion", async () => {
    // Nada de consultar ocupacion por recurso ni de anotar `freeResourceIds`: el unico
    // descuento es por coincidencia de instante de inicio, como el dia antes del cambio.
    mServiceFindUnique.mockResolvedValue(servicioSinInventario());
    mBlockedFindMany.mockResolvedValue([]);
    mResourceFindMany.mockResolvedValue([]);
    mGenerateSlots.mockReturnValue([SLOT_A, SLOT_B]);
    mSlotFindMany.mockResolvedValue([]);

    const slots = await computeAvailableSlots("svc-1", RANGO);

    expect(slots).toEqual([SLOT_A, SLOT_B]);
    expect(slots.every((s) => s.freeResourceIds === undefined)).toBe(true);
    expect(mSlotFindMany).toHaveBeenCalledTimes(1);
    expect(mSlotFindMany.mock.calls[0][0].where).not.toHaveProperty("resourceId");
  });
});

// ── createAppointment ───────────────────────────────────────────────────────
describe("createAppointment", () => {
  const start = new Date(SLOT_A.startTime);
  const end = new Date(SLOT_A.endTime);

  /**
   * Configura las LECTURAS del tx para que `computeAvailableSlots` vea el horario del
   * agente y devuelva `libres`. Sin esto, la guarda de integridad rechaza cualquier
   * reserva: es justamente lo que impide que el LLM invente una hora.
   */
  function conDisponibilidad(libres: { startTime: string; endTime: string }[]) {
    txMock.service.findUnique.mockResolvedValue(servicioSinInventario());
    txMock.service.findUniqueOrThrow.mockResolvedValue({
      agentId: "agent-1",
      name: "Corte",
      agent: { name: "Barberia Nunez" },
    });
    txMock.blockedRange.findMany.mockResolvedValue([]);
    txMock.timeSlot.findMany.mockResolvedValue([]);
    txMock.resource.findMany.mockResolvedValue([]);
    // Unidad implicita: no hay recurso previo, se crea uno y se vincula al servicio.
    txMock.resource.findFirst.mockResolvedValue(null);
    txMock.resource.create.mockResolvedValue({ id: "res-imp", name: "Corte", zone: null });
    txMock.serviceResource.createMany.mockResolvedValue({ count: 1 });
    mGenerateSlots.mockReturnValue(libres);
  }

  function citaCreada(over: Record<string, unknown> = {}) {
    return {
      id: "cita-1",
      partySize: 1,
      confirmationCode: "BAR-KJ7X",
      service: { id: "svc-1", name: "Corte", agentId: "agent-1" },
      ...over,
    };
  }

  it("crea franja + cita en transaccion y devuelve el resultado mapeado", async () => {
    conDisponibilidad([SLOT_A, SLOT_B]);
    txMock.timeSlot.create.mockResolvedValue({ id: "fr-1", startTime: start, endTime: end });
    txMock.appointment.create.mockResolvedValue(citaCreada());
    mIntegrationFindFirst.mockResolvedValue(null); // sin GCal

    const res = await createAppointment({
      serviceId: "svc-1",
      slotStart: start,
      slotEnd: end,
      email: "ana@example.com",
      phone: "600",
      notes: "Cliente: Ana",
    });

    // La franja cuelga de un RECURSO: `franja_horaria.recurso_id` es NOT NULL y el unique
    // paso de (servicio, inicio) a (recurso, inicio).
    expect(txMock.timeSlot.create).toHaveBeenCalledWith({
      data: {
        serviceId: "svc-1",
        resourceId: "res-imp",
        startTime: start,
        endTime: end,
        available: false,
      },
    });
    expect(res).toEqual({
      appointmentId: "cita-1",
      slotId: "fr-1",
      startTime: start,
      endTime: end,
      service: { id: "svc-1", name: "Corte", agentId: "agent-1" },
      partySize: 1,
      confirmationCode: "BAR-KJ7X",
      resource: { id: "res-imp", name: "Corte", zone: null },
    });
    expect(mSync).not.toHaveBeenCalled();
  });

  it("la cita guarda su propio horario, no solo la franja", async () => {
    // Cancelar BORRA la franja para liberar el instante (el unique no distingue libres de
    // ocupadas). Si la fecha viviera solo ahi, una cita cancelada se quedaria sin fecha y el
    // negocio no podria saber que se cancelo ni cuando.
    conDisponibilidad([SLOT_A]);
    txMock.timeSlot.create.mockResolvedValue({ id: "fr-1", startTime: start, endTime: end });
    txMock.appointment.create.mockResolvedValue(citaCreada());
    mIntegrationFindFirst.mockResolvedValue(null);

    await createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end });

    expect(txMock.appointment.create.mock.calls[0][0].data).toMatchObject({
      startTime: start,
      endTime: end,
    });
  });

  it("genera el codigo con el prefijo del negocio y sin caracteres confundibles", async () => {
    // El codigo se dicta por telefono mas veces que se copia: fuera 0/O, 1/I/L y 5/S.
    conDisponibilidad([SLOT_A]);
    txMock.timeSlot.create.mockResolvedValue({ id: "fr-1", startTime: start, endTime: end });
    txMock.appointment.create.mockResolvedValue(citaCreada());
    mIntegrationFindFirst.mockResolvedValue(null);

    await createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end });

    const codigo = txMock.appointment.create.mock.calls[0][0].data.confirmationCode as string;
    expect(codigo).toMatch(/^BAR-[ACDEFGHJKMNPQRTUVWXY2346789]{4}$/);
  });

  it("reintenta si el codigo choca con uno existente en vez de romper la reserva", async () => {
    conDisponibilidad([SLOT_A]);
    txMock.timeSlot.create.mockResolvedValue({ id: "fr-1", startTime: start, endTime: end });
    txMock.appointment.create
      .mockRejectedValueOnce({ code: "P2002", meta: { target: ["codigo_confirmacion"] } })
      .mockResolvedValueOnce(citaCreada());
    mIntegrationFindFirst.mockResolvedValue(null);

    await expect(
      createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end })
    ).resolves.toMatchObject({ appointmentId: "cita-1" });
    expect(txMock.appointment.create).toHaveBeenCalledTimes(2);
  });

  it("sincroniza GCal best-effort si hay integracion google", async () => {
    conDisponibilidad([SLOT_A]);
    txMock.timeSlot.create.mockResolvedValue({ id: "fr-1", startTime: start, endTime: end });
    txMock.appointment.create.mockResolvedValue(citaCreada());
    mIntegrationFindFirst.mockResolvedValue({ id: "int-1", provider: "google", metadata: {} });
    mSync.mockResolvedValue("evt-1");

    await createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end });
    expect(mSync).toHaveBeenCalled();
  });

  it("traduce el choque de unique (P2002) a SlotUnavailableError", async () => {
    conDisponibilidad([SLOT_A]);
    txMock.timeSlot.create.mockRejectedValue({ code: "P2002" });
    await expect(
      createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end })
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  // ── Guarda de integridad del slot (aa-reservas-validadas-y-cobertura-scraping) ──
  // Regresion de un fallo REAL observado en produccion: el agente creo una cita a las
  // 00:00 con un horario L-V 09:00-18:00, porque `createAppointment` escribia la hora
  // que devolviese el LLM sin comprobarla contra el horario del negocio.

  it("rechaza un slot fuera del horario (AC1)", async () => {
    // El horario solo genera SLOT_A (09:00) y SLOT_B (10:00); se pide medianoche.
    conDisponibilidad([SLOT_A, SLOT_B]);
    const medianoche = new Date("2026-07-20T00:00:00.000Z");
    const finMedianoche = new Date("2026-07-20T00:30:00.000Z");

    await expect(
      createAppointment({ serviceId: "svc-1", slotStart: medianoche, slotEnd: finMedianoche })
    ).rejects.toBeInstanceOf(SlotUnavailableError);

    // Lo que de verdad importa: NO se escribio nada.
    expect(txMock.timeSlot.create).not.toHaveBeenCalled();
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("rechaza un slot ya reservado (AC2)", async () => {
    // SLOT_A es teorico pero ya esta ocupado, asi que computeAvailableSlots lo resta.
    conDisponibilidad([SLOT_A, SLOT_B]);
    txMock.timeSlot.findMany.mockResolvedValue([{ startTime: new Date(SLOT_A.startTime) }]);

    await expect(
      createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end })
    ).rejects.toBeInstanceOf(SlotUnavailableError);
    expect(txMock.timeSlot.create).not.toHaveBeenCalled();
  });

  it("rechaza un slot desalineado con la rejilla aunque caiga en horario (AC1)", async () => {
    // 09:07-09:37 esta dentro de 09:00-18:00 pero no es un slot que `GET /slots` ofrezca.
    // Se exige coincidencia EXACTA para que la rejilla no se desincronice.
    conDisponibilidad([SLOT_A, SLOT_B]);

    await expect(
      createAppointment({
        serviceId: "svc-1",
        slotStart: new Date("2026-07-20T09:07:00.000Z"),
        slotEnd: new Date("2026-07-20T09:37:00.000Z"),
      })
    ).rejects.toBeInstanceOf(SlotUnavailableError);
    expect(txMock.timeSlot.create).not.toHaveBeenCalled();
  });

  it("valida leyendo por el tx, no por el cliente global (AC1)", async () => {
    // La lectura de disponibilidad tiene que caer DENTRO de la transaccion Serializable:
    // si se leyera fuera, entre el "esta libre" y el INSERT cabria otra reserva.
    conDisponibilidad([SLOT_A]);
    txMock.timeSlot.create.mockResolvedValue({ id: "fr-1", startTime: start, endTime: end });
    txMock.appointment.create.mockResolvedValue(citaCreada());
    mIntegrationFindFirst.mockResolvedValue(null);

    await createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end });

    expect(txMock.service.findUnique).toHaveBeenCalled();
    expect(mServiceFindUnique).not.toHaveBeenCalled();
  });

  it("acepta el hueco aunque venga con offset local en vez de UTC (AC1)", async () => {
    // `computeAvailableSlots` emite el ISO de luxon con offset ("+02:00") y aqui se parte de
    // un `Date`, cuyo `toISOString()` es UTC. Es el MISMO instante: comparar las cadenas
    // rechazaba todas las reservas como "slot ya ocupado" — medido contra el agente real,
    // 0/5 conversaciones lograban cerrar cita. Este fixture usa la forma con offset a
    // proposito; el anterior, en Z, no distinguia los dos casos.
    conDisponibilidad([{ startTime: "2026-07-20T11:00:00.000+02:00", endTime: "2026-07-20T11:30:00.000+02:00" }]);
    txMock.timeSlot.create.mockResolvedValue({ id: "fr-1", startTime: start, endTime: end });
    txMock.appointment.create.mockResolvedValue(citaCreada());
    mIntegrationFindFirst.mockResolvedValue(null);

    await expect(
      createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end })
    ).resolves.toMatchObject({ appointmentId: "cita-1" });
  });

  // ── Unidad implicita (T5.6) ──
  it("crea y vincula el recurso implicito cuando el agente no declara inventario", async () => {
    // `franja_horaria.recurso_id` es NOT NULL, asi que un negocio que nunca configuro mesas
    // ni cabinas necesita un recurso real. Se crea uno POR SERVICIO y se vincula, igual que
    // el backfill de la migracion: con el vinculo, la capacidad de un servicio no depende de
    // los recursos de otro.
    conDisponibilidad([SLOT_A]);
    txMock.timeSlot.create.mockResolvedValue({ id: "fr-1", startTime: start, endTime: end });
    txMock.appointment.create.mockResolvedValue(citaCreada());
    mIntegrationFindFirst.mockResolvedValue(null);

    await createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end });

    expect(txMock.resource.create).toHaveBeenCalledWith({
      data: { agentId: "agent-1", name: "Corte", kind: "room", capacityMin: 1, capacityMax: 1 },
      select: { id: true, name: true, zone: true },
    });
    expect(txMock.serviceResource.createMany).toHaveBeenCalledWith({
      data: [{ serviceId: "svc-1", resourceId: "res-imp" }],
      skipDuplicates: true,
    });
  });

  it("reutiliza el recurso implicito en la segunda reserva en vez de duplicarlo", async () => {
    conDisponibilidad([SLOT_A]);
    txMock.resource.findFirst.mockResolvedValue({ id: "res-imp", name: "Corte", zone: null });
    txMock.timeSlot.create.mockResolvedValue({ id: "fr-1", startTime: start, endTime: end });
    txMock.appointment.create.mockResolvedValue(citaCreada());
    mIntegrationFindFirst.mockResolvedValue(null);

    await createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end });

    expect(txMock.resource.create).not.toHaveBeenCalled();
  });
});

// ── cancelAppointment ───────────────────────────────────────────────────────
describe("cancelAppointment", () => {
  it("BORRA la franja + marca la cita cancelada", async () => {
    // Se borra en vez de marcarla `disponible=true`: el unique (recurso, inicio) no distingue
    // libres de ocupadas, asi que con la fila viva el hueco liberado no se podia volver a
    // reservar NUNCA — la reserva siguiente chocaba contra el indice.
    mApptFindUnique.mockResolvedValue({
      id: "cita-1",
      slotId: "fr-1",
      status: "scheduled",
      gcalEventId: null,
      service: { agentId: "agent-1", agent: {} },
    });

    const res = await cancelAppointment("cita-1");
    expect(res).toEqual({ ok: true, estado: "cancelled" });
    expect(mSlotDelete).toHaveBeenCalledWith({ where: { id: "fr-1" } });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("no intenta borrar franja si la cita ya no la tiene", async () => {
    // `cita.franja_id` es nullable con ON DELETE SET NULL: una cita cuya franja ya
    // desaparecio sigue siendo cancelable, no un 500.
    mApptFindUnique.mockResolvedValue({
      id: "cita-1",
      slotId: null,
      status: "scheduled",
      gcalEventId: null,
      service: { agentId: "agent-1", agent: {} },
    });

    await expect(cancelAppointment("cita-1")).resolves.toEqual({ ok: true, estado: "cancelled" });
    expect(mSlotDelete).not.toHaveBeenCalled();
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
