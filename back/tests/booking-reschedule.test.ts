import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { getCalendarProvider, mockCalendarDb } from "../src/lib/integrations/calendar-provider";

const prismaMock = vi.hoisted(() => ({
  appointment: { findUnique: vi.fn(), update: vi.fn() },
  // `findMany` alimenta la comprobacion de disponibilidad de la reprogramacion: sin franjas
  // ocupadas, el hueco nuevo esta libre y la ruta llega a la parte que este fichero prueba.
  timeSlot: { update: vi.fn(), findMany: vi.fn(async () => []) },
  service: { findUnique: vi.fn() },
  blockedRange: { findMany: vi.fn(async () => []) },
  resource: { findMany: vi.fn(async () => []) },
  integration: { findFirst: vi.fn() },
  // La ruta paso de `$transaction([ops])` a `$transaction(cb, { isolationLevel })` para que la
  // comprobacion de disponibilidad y las dos escrituras caigan en el mismo Serializable.
  // Se aceptan las dos formas para no atar el doble a un detalle de implementacion.
  $transaction: vi.fn(async (arg: unknown) =>
    typeof arg === "function"
      ? await (arg as (tx: unknown) => Promise<unknown>)(prismaMock)
      : Promise.all(arg as Promise<unknown>[])
  ),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {},
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            let parsed: any = null;
            try {
              parsed = data ? JSON.parse(data) : null;
            } catch {
              parsed = data;
            }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        }
      );
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// Cita base con calendario externo conectado (provider mock ejerce el contrato real)
function baseAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: "appt-1",
    slotId: "slot-1",
    serviceId: "svc-1",
    partySize: 1,
    status: "scheduled",
    gcalEventId: null as string | null,
    email: "lead@example.com",
    phone: null,
    notes: null,
    slot: {
      id: "slot-1",
      resourceId: null as string | null,
      startTime: new Date(`${DIA}T09:00:00.000Z`),
      endTime: new Date(`${DIA}T09:30:00.000Z`),
    },
    service: {
      id: "svc-1",
      name: "Consultoría",
      agentId: "agent-1",
      agent: { id: "agent-1" },
    },
    ...overrides,
  };
}

// Fechas relativas al reloj real: `generateSlots` no emite huecos en el pasado, asi que unas
// constantes fijas caducaban el dia que la fecha quedaba atras y devolvian 409 para siempre.
const DIA = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const NEW_START = `${DIA}T11:00:00.000Z`;
const NEW_END = `${DIA}T11:30:00.000Z`;

// Servicio 24/7 en UTC con rejilla de 30 min: 11:00 cae exactamente en un hueco teorico.
const HORARIO_ABIERTO = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, "00:00-23:30"])
);

describe("PATCH /api/booking/:id/reschedule", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCalendarDb.clear();

    prismaMock.timeSlot.update.mockResolvedValue({});
    prismaMock.appointment.update.mockResolvedValue({});
    prismaMock.timeSlot.findMany.mockResolvedValue([]);
    prismaMock.resource.findMany.mockResolvedValue([]);
    prismaMock.blockedRange.findMany.mockResolvedValue([]);
    // Lo que lee `computeAvailableSlots` al validar la hora nueva.
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      agentId: "agent-1",
      duration: 30,
      slotStepMin: 30,
      bufferMin: 0,
      maxPartySize: 8,
      schedule: null,
      resources: [],
      agent: { id: "agent-1", schedule: { id: "sch-1", timezone: "UTC", schedule: HORARIO_ABIERTO } },
    });

    const { bookingRouter } = await import("@/routes/booking");
    app = express();
    app.use(express.json());
    app.use("/api/booking", bookingRouter);
    // Mapea HttpError a status (equivalente al errorHandler central de index.ts)
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.status || 500).json({ error: err.message });
    });
  });

  it("propagates the reschedule to the external calendar (provider updateEvent)", async () => {
    // Evento pre-existente en el calendario externo (mock provider)
    const provider = getCalendarProvider("mock", "test-token");
    const { externalId } = await provider.createEvent({
      title: "Consultoría — lead@example.com",
      startIso: "2026-07-10T09:00:00.000Z",
      endIso: "2026-07-10T09:30:00.000Z",
    });

    prismaMock.appointment.findUnique.mockResolvedValue(baseAppointment({ gcalEventId: externalId }));
    prismaMock.integration.findFirst.mockResolvedValue({
      id: "int-1",
      agentId: "agent-1",
      provider: "mock",
      metadata: {},
    });

    const res = await request(app, "PATCH", "/api/booking/appt-1/reschedule", {
      slotStartTime: NEW_START,
      slotEndTime: NEW_END,
      notes: "Reprogramada por el cliente",
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.appointmentId).toBe("appt-1");

    // El slot local se movió dentro de la transacción
    expect(prismaMock.timeSlot.update).toHaveBeenCalledWith({
      where: { id: "slot-1" },
      data: { startTime: new Date(NEW_START), endTime: new Date(NEW_END) },
    });
    // La cita guarda su PROPIO horario desde `20260730010000_cita_horas_propias`: cancelar
    // borra la franja para liberar el instante, asi que una cita cancelada se quedaba sin
    // fecha. Reprogramar tiene que mover las dos filas o la cita apuntaria a una hora
    // distinta de la que ocupa en el inventario.
    expect(prismaMock.appointment.update).toHaveBeenCalledWith({
      where: { id: "appt-1" },
      data: {
        startTime: new Date(NEW_START),
        endTime: new Date(NEW_END),
        notes: "Reprogramada por el cliente",
      },
    });

    // La sincronización es fire-and-forget: esperar a que llegue al provider
    await vi.waitFor(() => {
      expect(mockCalendarDb.get(externalId)).toMatchObject({
        title: "Consultoría — lead@example.com",
        startIso: NEW_START,
        endIso: NEW_END,
      });
    });
  });

  it("does not touch the external calendar when the appointment has no synced event", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(baseAppointment({ gcalEventId: null }));

    const res = await request(app, "PATCH", "/api/booking/appt-1/reschedule", {
      slotStartTime: NEW_START,
      slotEndTime: NEW_END,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Sin gcalEventId no se busca integración ni se llama al provider
    await new Promise((r) => setTimeout(r, 20));
    expect(prismaMock.integration.findFirst).not.toHaveBeenCalled();
    expect(mockCalendarDb.size).toBe(0);
    // La cita SI se actualiza aunque el body no traiga notes: desde que guarda su propio
    // horario, mover la franja sin mover la cita la dejaria con la fecha vieja.
    expect(prismaMock.appointment.update).toHaveBeenCalledWith({
      where: { id: "appt-1" },
      data: { startTime: new Date(NEW_START), endTime: new Date(NEW_END) },
    });
  });

  it("returns 200 even if the external calendar update fails (best-effort)", async () => {
    // gcalEventId apunta a un evento inexistente → provider.updateEvent lanza
    prismaMock.appointment.findUnique.mockResolvedValue(baseAppointment({ gcalEventId: "ghost-evt" }));
    prismaMock.integration.findFirst.mockResolvedValue({
      id: "int-1",
      agentId: "agent-1",
      provider: "mock",
      metadata: {},
    });

    const res = await request(app, "PATCH", "/api/booking/appt-1/reschedule", {
      slotStartTime: NEW_START,
      slotEndTime: NEW_END,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // El fallo remoto se registra y no afecta a la respuesta del API
    await new Promise((r) => setTimeout(r, 20));
    expect(mockCalendarDb.has("ghost-evt")).toBe(false);
  });

  it("returns 404 for an unknown appointment", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(null);

    const res = await request(app, "PATCH", "/api/booking/nope/reschedule", {
      slotStartTime: NEW_START,
      slotEndTime: NEW_END,
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 for a cancelled appointment", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(baseAppointment({ status: "cancelled" }));

    const res = await request(app, "PATCH", "/api/booking/appt-1/reschedule", {
      slotStartTime: NEW_START,
      slotEndTime: NEW_END,
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid time range", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(baseAppointment());

    const res = await request(app, "PATCH", "/api/booking/appt-1/reschedule", {
      slotStartTime: NEW_END,
      slotEndTime: NEW_START, // fin antes del inicio
    });

    expect(res.status).toBe(400);
    expect(prismaMock.timeSlot.update).not.toHaveBeenCalled();
  });
});
