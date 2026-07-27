/**
 * H3 (aa-agente-ciclo-vida-publicacion) — Las superficies que NO pasan por el motor.
 *
 * El gate del cuello (`runAgent`/`chatWithAgent`) cubre lo que gasta LLM. Pero un agente no
 * publicado seguía filtrando su marca por `/widget/config` y aceptando compromisos reales
 * —una cita en el calendario, un WhatsApp a una persona— sin gastar un solo token. "No
 * consume tokens" no exime: T2.3, T2.4 y T2.5 cierran esas vías.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn(), updateMany: vi.fn() },
    service: { findUnique: vi.fn() },
    appointment: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/agent/engine", () => ({ chatWithAgent: vi.fn() }));
vi.mock("@/lib/booking/appointments", () => ({
  computeAvailableSlots: vi.fn(async () => [{ startTime: "2026-08-01T09:00:00.000Z" }]),
  createAppointment: vi.fn(async () => ({
    appointmentId: "ap1",
    slotId: "s1",
    startTime: "2026-08-01T09:00:00.000Z",
    endTime: "2026-08-01T09:30:00.000Z",
  })),
  cancelAppointment: vi.fn(),
  ServiceNotFoundError: class ServiceNotFoundError extends Error {},
  ScheduleNotConfiguredError: class ScheduleNotConfiguredError extends Error {},
  SlotUnavailableError: class SlotUnavailableError extends Error {},
  AppointmentNotFoundError: class AppointmentNotFoundError extends Error {},
  AppointmentAlreadyCancelledError: class AppointmentAlreadyCancelledError extends Error {},
}));
vi.mock("@/lib/booking/sync", () => ({ updateAppointmentInExternalCalendar: vi.fn() }));

import { prisma } from "@/lib/db";
import { chatWithAgent } from "@/lib/agent/engine";
import { computeAvailableSlots, createAppointment } from "@/lib/booking/appointments";
import { aiRouter } from "@/routes/ai";
import { bookingRouter } from "@/routes/booking";
import { HttpError } from "@/lib/http";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", aiRouter);
  app.use("/api/booking", bookingRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message });
  });
  return app;
}

function request(
  app: express.Express,
  method: string,
  path: string,
  payload?: unknown
): Promise<{ status: number; body: any }> {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const headers: Record<string, string> = body
    ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) }
    : {};
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
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
      });
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      if (body) req.write(body);
      req.end();
    });
  });
}

function widgetAgent(status: string) {
  return {
    name: "Bot de Clínica Norte",
    status,
    widgetPrimaryColor: "#111111",
    widgetSecondaryColor: "#222222",
    widgetAvatarBase64: null,
    widgetAvatarUrl: null,
    widgetAvatarEmoji: null,
    widgetTemplateConfig: null,
  };
}

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  app = buildApp();
  asMock(prisma.agent.updateMany).mockResolvedValue({ count: 1 });
});

describe("T2.3 — GET /api/widget/config", () => {
  it("published ⇒ 200 con la config", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(widgetAgent("published"));

    const res = await request(app, "GET", "/api/widget/config?publicKey=pk_1");

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Bot de Clínica Norte");
  });

  it("draft ⇒ 404 y no filtra nombre ni colores", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(widgetAgent("draft"));

    const res = await request(app, "GET", "/api/widget/config?publicKey=pk_1");

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/Clínica Norte|#111111/);
  });

  it("404, no 403: un 403 confirmaría que la clave es válida", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(widgetAgent("suspended"));
    const conBorrador = await request(app, "GET", "/api/widget/config?publicKey=pk_1");

    asMock(prisma.agent.findUnique).mockResolvedValue(null);
    const conClaveFalsa = await request(app, "GET", "/api/widget/config?publicKey=pk_inventada");

    // Indistinguibles a propósito: mismo status y mismo cuerpo.
    expect(conBorrador.status).toBe(404);
    expect(conBorrador.status).toBe(conClaveFalsa.status);
    expect(conBorrador.body).toEqual(conClaveFalsa.body);
  });

  it("archived ⇒ 404", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(widgetAgent("archived"));
    expect((await request(app, "GET", "/api/widget/config?publicKey=pk_1")).status).toBe(404);
  });
});

describe("T2.4 — POST /api/widget/ping no cambia", () => {
  it("draft ⇒ 204 y no lanza: es telemetría best-effort", async () => {
    // Ya está diseñado para no confirmar ni negar existencia; meterle el gate no aportaría
    // nada y sí quitaría la señal de "hay un widget cargado" que usa el panel.
    const res = await request(app, "POST", "/api/widget/ping", { publicKey: "pk_1" });
    expect(res.status).toBe(204);
  });
});

describe("T2.2 — la exención isTest sólo se honra con sesión de operador", () => {
  /** Igual que el gate global de `index.ts`: resuelve `req.user` incluso en rutas públicas. */
  function appConSesion() {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      req.user = { id: "u1", email: "op@estudio.com", role: "admin" } as never;
      next();
    });
    a.use("/api", aiRouter);
    return a;
  }

  beforeEach(() => {
    asMock(prisma.agent.findUnique).mockResolvedValue({ id: "a1", tenantId: "tenant-1" });
    asMock(chatWithAgent).mockResolvedValue({ text: "ok" });
  });

  it("test:true SIN sesión llega al motor como isTest=false ⇒ el borrador no atiende", async () => {
    // `/api/chat` es pública. Sin este filtro, cualquiera con la publicKey mandaría
    // `test:true` y hablaría con un borrador (y saltaría el cupo de H1) desde fuera.
    await request(app, "POST", "/api/chat", { publicKey: "pk_1", message: "hola", test: true });

    expect(asMock(chatWithAgent).mock.calls[0][5]).toBe(false);
  });

  it("test:true CON sesión llega como isTest=true ⇒ la consola puede probar un borrador", async () => {
    await request(appConSesion(), "POST", "/api/chat", {
      publicKey: "pk_1",
      message: "hola",
      test: true,
    });

    expect(asMock(chatWithAgent).mock.calls[0][5]).toBe(true);
  });

  it("el 403 del gate de publicación llega como 403 al widget, no como 500", async () => {
    // Mismo criterio que el 402 de H1: el motivo real no puede leerse como una caída.
    asMock(chatWithAgent).mockRejectedValueOnce(new HttpError(403, "no publicado"));

    const res = await request(app, "POST", "/api/chat", { publicKey: "pk_1", message: "hola" });

    expect(res.status).toBe(403);
  });
});

describe("T2.5 — reservas: compromiso real sin un solo token de LLM", () => {
  function servicioDeAgente(status: string) {
    return { agent: { status } };
  }

  it("GET /slots de un draft ⇒ 403 y no se calculan slots", async () => {
    // Los slots ya revelan servicios y horarios del negocio: se corta aquí, no sólo al reservar.
    asMock(prisma.service.findUnique).mockResolvedValue(servicioDeAgente("draft"));

    const res = await request(
      app,
      "GET",
      "/api/booking/slots?serviceId=s1&startDate=2026-08-01&endDate=2026-08-02"
    );

    expect(res.status).toBe(403);
    expect(computeAvailableSlots).not.toHaveBeenCalled();
  });

  it("GET /slots de un published ⇒ 200", async () => {
    asMock(prisma.service.findUnique).mockResolvedValue(servicioDeAgente("published"));

    const res = await request(
      app,
      "GET",
      "/api/booking/slots?serviceId=s1&startDate=2026-08-01&endDate=2026-08-02"
    );

    expect(res.status).toBe(200);
    expect(computeAvailableSlots).toHaveBeenCalled();
  });

  it("POST /reserve de un draft ⇒ 403 y no se crea cita", async () => {
    asMock(prisma.service.findUnique).mockResolvedValue(servicioDeAgente("draft"));

    const res = await request(app, "POST", "/api/booking/reserve", {
      serviceId: "s1",
      slotStartTime: "2026-08-01T09:00:00.000Z",
      slotEndTime: "2026-08-01T09:30:00.000Z",
    });

    expect(res.status).toBe(403);
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("POST /reserve de un published ⇒ 201", async () => {
    asMock(prisma.service.findUnique).mockResolvedValue(servicioDeAgente("published"));

    const res = await request(app, "POST", "/api/booking/reserve", {
      serviceId: "s1",
      slotStartTime: "2026-08-01T09:00:00.000Z",
      slotEndTime: "2026-08-01T09:30:00.000Z",
    });

    expect(res.status).toBe(201);
    expect(createAppointment).toHaveBeenCalled();
  });

  it("servicio inexistente NO lo decide el gate: lo resuelve el camino actual (404)", async () => {
    // Cambiar aquí la semántica del 'servicio no encontrado' sería un efecto colateral del
    // change, no parte de él.
    asMock(prisma.service.findUnique).mockResolvedValue(null);
    asMock(createAppointment).mockRejectedValueOnce(new HttpError(404, "Servicio no encontrado"));

    const res = await request(app, "POST", "/api/booking/reserve", {
      serviceId: "s-borrado",
      slotStartTime: "2026-08-01T09:00:00.000Z",
      slotEndTime: "2026-08-01T09:30:00.000Z",
    });

    expect(res.status).toBe(404);
  });
});
