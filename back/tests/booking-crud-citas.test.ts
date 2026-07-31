/**
 * CRUD de citas de punta a punta, por HTTP, contra la semantica real del schema
 * (aa-reservas-multirecurso-y-mocks-sectoriales, bloque E).
 *
 * Las cuatro operaciones viven en sitios distintos y hasta ahora se probaban por separado
 * con mocks planos: crear y cancelar en `lib/booking/appointments.ts`, listar y REPROGRAMAR
 * inline en `routes/booking.ts`. Reprogramar es la unica que no pasa por
 * `computeAvailableSlots`, asi que ningun test de la libreria la cubria.
 *
 * Aqui el router de express real corre contra la tabla en memoria de
 * `helpers/booking-db-memoria.ts`, que respeta el unique `(recurso_id, inicio)` y el
 * ON DELETE SET NULL de `cita.franja_id`. Las afirmaciones son sobre el ESTADO resultante,
 * no sobre que se llamase a tal metodo de prisma.
 *
 * Inventario: dos mesas, m1 para 1-2 comensales y m2 para 3-6. Un grupo de dos solo cabe en
 * m1, y eso es lo que hace que los choques sean observables.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", async () => {
  const { facade } = await import("./helpers/booking-db-memoria");
  return { prisma: facade };
});
vi.mock("@/lib/booking/sync", () => ({
  syncAppointmentToGcal: vi.fn(),
  unsyncAppointmentFromGcal: vi.fn(),
  updateAppointmentInExternalCalendar: vi.fn(),
}));

import { db, resetDb, SERVICIO, facade, p2002 } from "./helpers/booking-db-memoria";

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

const DIA = "2026-08-04";
/** Las 21:00 y las 22:00 en el reloj del negocio (Madrid, CEST). */
const CENA = { inicio: "2026-08-04T19:00:00.000Z", fin: "2026-08-04T19:30:00.000Z" };
const CENA_TARDE = { inicio: "2026-08-04T20:00:00.000Z", fin: "2026-08-04T20:30:00.000Z" };
const CONTACTO = { leadEmail: "ana@example.com", leadPhone: "+34 600 11 22 33" };

let app: express.Express;

async function reservar(over: Record<string, unknown> = {}) {
  return request(app, "POST", "/api/booking/reserve", {
    serviceId: SERVICIO.id,
    slotStartTime: CENA.inicio,
    slotEndTime: CENA.fin,
    ...CONTACTO,
    partySize: 2,
    customerName: "Ana",
    ...over,
  });
}

const huecos = async (partySize = 2) =>
  request(
    app,
    "GET",
    `/api/booking/slots?serviceId=${SERVICIO.id}&startDate=${DIA}T00:00:00.000Z&endDate=${DIA}T23:59:59.000Z&partySize=${partySize}`
  );

const ofrece = (res: { body: any }, iso: string) =>
  (res.body.slots as Array<{ startTime: string }>).some(
    (s) => new Date(s.startTime).getTime() === new Date(iso).getTime()
  );

beforeEach(async () => {
  resetDb();
  vi.clearAllMocks();
  const { bookingRouter } = await import("@/routes/booking");
  app = express();
  app.use(express.json());
  app.use("/api/booking", bookingRouter);
  // Equivalente al errorHandler central de index.ts.
  app.use((err: any, _req: express.Request, res: express.Response, _n: express.NextFunction) => {
    res.status(err.status || 500).json({ error: err.message });
  });
});

// ── C ───────────────────────────────────────────────────────────────────────

describe("CREAR — POST /api/booking/reserve", () => {
  it("crea la cita, asigna la mesa mas ajustada y devuelve codigo de confirmacion", async () => {
    const res = await reservar();

    expect(res.status).toBe(201);
    expect(res.body.resource).toMatchObject({ id: "m1", name: "Mesa 1" });
    expect(res.body.partySize).toBe(2);
    expect(res.body.confirmationCode).toMatch(/^[A-Z]{3}-[A-Z0-9]{4}$/);

    expect(db.citas).toHaveLength(1);
    expect(db.slots).toHaveLength(1);
    expect(db.citas[0]).toMatchObject({ status: "scheduled", partySize: 2, customerName: "Ana" });
    // La cita guarda su propio horario, no solo el de la franja.
    expect(db.citas[0].startTime.toISOString()).toBe(CENA.inicio);
  });

  it("una pareja no quema la mesa de seis: esa sigue libre para un grupo grande", async () => {
    await reservar();
    const paraCuatro = await huecos(4);
    expect(ofrece(paraCuatro, CENA.inicio)).toBe(true);
  });

  it("sin mesa que quepa a esa hora responde 409, no 500", async () => {
    await reservar();
    const segunda = await reservar();
    expect(segunda.status).toBe(409);
    expect(db.citas).toHaveLength(1);
  });

  it("un grupo mayor que el aforo del servicio responde 422 y no crea nada", async () => {
    const res = await reservar({ partySize: SERVICIO.maxPartySize + 1 });
    expect(res.status).toBe(422);
    expect(db.citas).toHaveLength(0);
  });

  it("servicio inexistente responde 404", async () => {
    const res = await reservar({ serviceId: "svc-fantasma" });
    expect(res.status).toBe(404);
  });
});

// ── R ───────────────────────────────────────────────────────────────────────

describe("LEER — GET /slots y GET /appointments", () => {
  it("el hueco reservado deja de ofrecerse para ese aforo", async () => {
    const antes = await huecos(2);
    expect(ofrece(antes, CENA.inicio)).toBe(true);

    await reservar();

    const despues = await huecos(2);
    expect(ofrece(despues, CENA.inicio)).toBe(false);
  });

  it("/slots no publica los ids de inventario", async () => {
    const res = await huecos(2);
    expect(res.status).toBe(200);
    for (const s of res.body.slots) expect(Object.keys(s).sort()).toEqual(["endTime", "startTime"]);
  });

  it("el listado general da la hora en el reloj del negocio, no en UTC", async () => {
    await reservar();
    const res = await request(app, "GET", "/api/booking/appointments");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    // 19:00Z son las 21:00 en Madrid: es la hora que ve el operador en el panel.
    expect(res.body[0]).toMatchObject({ date: "2026-08-04", time: "21:00", status: "Confirmada" });
  });

  it("el listado por servicio devuelve el codigo y el aforo de cada cita", async () => {
    const creada = await reservar();
    const res = await request(app, "GET", `/api/booking/appointments/${SERVICIO.id}`);

    expect(res.status).toBe(200);
    expect(res.body.appointments).toHaveLength(1);
    expect(res.body.appointments[0]).toMatchObject({
      id: creada.body.appointmentId,
      confirmationCode: creada.body.confirmationCode,
      partySize: 2,
      status: "scheduled",
    });
  });
});

// ── U ───────────────────────────────────────────────────────────────────────

describe("ACTUALIZAR — PATCH /api/booking/:id/reschedule", () => {
  it("mueve la franja y la cita a la vez", async () => {
    const creada = await reservar();

    const res = await request(app, "PATCH", `/api/booking/${creada.body.appointmentId}/reschedule`, {
      slotStartTime: CENA_TARDE.inicio,
      slotEndTime: CENA_TARDE.fin,
      notes: "El cliente llega mas tarde",
    });

    expect(res.status).toBe(200);
    expect(db.slots[0].startTime.toISOString()).toBe(CENA_TARDE.inicio);
    expect(db.citas[0].startTime.toISOString()).toBe(CENA_TARDE.inicio);
    expect(db.citas[0].notes).toBe("El cliente llega mas tarde");
  });

  it("el hueco viejo vuelve a ofrecerse y el nuevo deja de estarlo", async () => {
    const creada = await reservar();
    await request(app, "PATCH", `/api/booking/${creada.body.appointmentId}/reschedule`, {
      slotStartTime: CENA_TARDE.inicio,
      slotEndTime: CENA_TARDE.fin,
    });

    const libres = await huecos(2);
    expect(ofrece(libres, CENA.inicio)).toBe(true);
    expect(ofrece(libres, CENA_TARDE.inicio)).toBe(false);
  });

  it("no reprograma encima de otra cita que ocupa la misma mesa a la misma hora", async () => {
    const primera = await reservar();
    const segunda = await reservar({ slotStartTime: CENA_TARDE.inicio, slotEndTime: CENA_TARDE.fin });
    expect(segunda.status).toBe(201);

    // Las dos estan en m1: es la unica mesa donde cabe una pareja.
    expect(db.slots.map((s) => s.resourceId)).toEqual(["m1", "m1"]);

    const res = await request(app, "PATCH", `/api/booking/${segunda.body.appointmentId}/reschedule`, {
      slotStartTime: CENA.inicio,
      slotEndTime: CENA.fin,
    });

    // 409: el instante esta ocupado. Un 500 seria el unique de la BD escapandose sin mapear.
    expect(res.status).toBe(409);
    expect(db.citas.find((c) => c.id === primera.body.appointmentId)!.startTime.toISOString()).toBe(
      CENA.inicio
    );
  });

  it("no reprograma a una hora que SOLAPA con otra cita de la misma mesa", async () => {
    await reservar();
    const segunda = await reservar({ slotStartTime: CENA_TARDE.inicio, slotEndTime: CENA_TARDE.fin });

    // 19:15Z cae dentro de la cena de las 19:00-19:30 que ya ocupa m1. El unique
    // `(recurso_id, inicio)` NO lo detecta: los inicios son distintos.
    const res = await request(app, "PATCH", `/api/booking/${segunda.body.appointmentId}/reschedule`, {
      slotStartTime: "2026-08-04T19:15:00.000Z",
      slotEndTime: "2026-08-04T19:45:00.000Z",
    });

    expect(res.status).toBe(409);
    // La mesa 1 no puede tener dos comensales distintos a la vez.
    expect(db.slots.filter((s) => s.resourceId === "m1")).toHaveLength(2);
    const solapan = db.slots[0].startTime < db.slots[1].endTime && db.slots[1].startTime < db.slots[0].endTime;
    expect(solapan).toBe(false);
  });

  it("no reprograma fuera del horario del negocio", async () => {
    const creada = await reservar();
    // 04:00Z = 06:00 en Madrid. El servicio abre a las 13:00.
    const res = await request(app, "PATCH", `/api/booking/${creada.body.appointmentId}/reschedule`, {
      slotStartTime: "2026-08-04T04:00:00.000Z",
      slotEndTime: "2026-08-04T04:30:00.000Z",
    });

    expect(res.status).toBe(409);
    expect(db.citas[0].startTime.toISOString()).toBe(CENA.inicio);
  });

  it("devuelve 409 (no 500) si otro reserva la misma hora entre el check y la escritura", async () => {
    const creada = await reservar();

    // Carrera real: la comprobacion de disponibilidad dice "libre" y, antes de que la escritura
    // llegue, otra transaccion ocupa la franja. El unique `(recurso_id, inicio)` emerge como
    // P2002 dentro del `$transaction`; sin traducirlo, el operador veia un 500 opaco.
    const original = facade.timeSlot.update.getMockImplementation()!;
    facade.timeSlot.update.mockImplementationOnce(async () => {
      throw p2002(["recurso_id", "inicio"]);
    });

    const res = await request(app, "PATCH", `/api/booking/${creada.body.appointmentId}/reschedule`, {
      slotStartTime: CENA_TARDE.inicio,
      slotEndTime: CENA_TARDE.fin,
    });

    expect(res.status).toBe(409);
    facade.timeSlot.update.mockImplementation(original);
    // La cita conserva su hora: la escritura fallida no dejo rastro parcial.
    expect(db.citas[0].startTime.toISOString()).toBe(CENA.inicio);
  });

  it("no reprograma una cita cancelada", async () => {
    const creada = await reservar();
    await request(app, "PATCH", `/api/booking/${creada.body.appointmentId}/cancel`, {});

    const res = await request(app, "PATCH", `/api/booking/${creada.body.appointmentId}/reschedule`, {
      slotStartTime: CENA_TARDE.inicio,
      slotEndTime: CENA_TARDE.fin,
    });
    expect(res.status).toBe(400);
  });
});

// ── D ───────────────────────────────────────────────────────────────────────

describe("CANCELAR — PATCH /api/booking/:id/cancel", () => {
  it("libera la mesa, conserva la fecha de la cita y la marca cancelada", async () => {
    const creada = await reservar();

    const res = await request(app, "PATCH", `/api/booking/${creada.body.appointmentId}/cancel`, {
      reason: "El cliente no puede",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    expect(db.slots).toHaveLength(0);
    expect(db.citas[0]).toMatchObject({ status: "cancelled", slotId: null });
    // La franja desaparece; la fecha vive en la cita desde `20260730010000_cita_horas_propias`.
    expect(db.citas[0].startTime.toISOString()).toBe(CENA.inicio);
  });

  it("el hueco vuelve a ofrecerse y se puede volver a reservar", async () => {
    const creada = await reservar();
    await request(app, "PATCH", `/api/booking/${creada.body.appointmentId}/cancel`, {});

    const libres = await huecos(2);
    expect(ofrece(libres, CENA.inicio)).toBe(true);

    const otra = await reservar({ leadEmail: "otro@example.com" });
    expect(otra.status).toBe(201);
    expect(otra.body.appointmentId).not.toBe(creada.body.appointmentId);
  });

  it("cancelar dos veces responde 400", async () => {
    const creada = await reservar();
    await request(app, "PATCH", `/api/booking/${creada.body.appointmentId}/cancel`, {});
    const segunda = await request(app, "PATCH", `/api/booking/${creada.body.appointmentId}/cancel`, {});
    expect(segunda.status).toBe(400);
  });

  it("cancelar una cita inexistente responde 404", async () => {
    const res = await request(app, "PATCH", "/api/booking/cita-fantasma/cancel", {});
    expect(res.status).toBe(404);
  });

  it("la cita cancelada sigue en el listado, marcada como Cancelada y con su fecha", async () => {
    const creada = await reservar();
    await request(app, "PATCH", `/api/booking/${creada.body.appointmentId}/cancel`, {});

    const res = await request(app, "GET", "/api/booking/appointments");
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ status: "Cancelada", date: "2026-08-04", time: "21:00" });
  });
});
