/**
 * agenda-appointments-patch.test.ts — aa-agenda-crm-parity (T6, cubre T8 vía
 * payload { status } sobre el mismo endpoint).
 *
 * Covers PATCH /api/agenda/appointments/:id:
 *  - 404 si el id no existe
 *  - PATCH solo status → 200, fila actualizada, sin llamada a Google si no hay gcalEventId
 *  - PATCH con gcalEventId + PlatformIntegration conectada → llama updateEvent
 *  - 400 con status inválido
 *
 * Pattern: minimal Express app mounting the router directly, mocked
 * prisma / oauth / calendar libs. Mirrors calendar-route.test.ts approach.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    platformAppointment: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    platformIntegration: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/integrations/oauth", () => ({
  getValidPlatformToken: vi.fn(),
}));

vi.mock("@/lib/integrations/calendar", () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { getValidPlatformToken } from "@/lib/integrations/oauth";
import { updateEvent } from "@/lib/integrations/calendar";
import { agendaAppointmentsRouter } from "@/routes/agenda-appointments";
import { errorHandler } from "@/lib/observability";

const mockApptFindUnique = prisma.platformAppointment.findUnique as ReturnType<typeof vi.fn>;
const mockApptUpdate = prisma.platformAppointment.update as ReturnType<typeof vi.fn>;
const mockIntegrationFindUnique = prisma.platformIntegration.findUnique as ReturnType<typeof vi.fn>;
const mockGetValidPlatformToken = getValidPlatformToken as ReturnType<typeof vi.fn>;
const mockUpdateEvent = updateEvent as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agenda", agendaAppointmentsRouter);
  app.use(errorHandler);
  return app;
}

async function patch(app: express.Express, path: string, body: unknown) {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const resBody = (await res.json().catch(() => null)) as any;
    return { status: res.status, body: resBody };
  } finally {
    server.close();
  }
}

const BASE_ROW = {
  id: "appt-1",
  startAt: new Date("2026-07-10T09:00:00"),
  endAt: new Date("2026-07-10T09:30:00"),
  client: "Clínica Norte",
  service: "Consultoría",
  notes: "nota original",
  status: "Confirmada",
  gcalEventId: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/agenda/appointments/:id", () => {
  it("404 si el id no existe", async () => {
    mockApptFindUnique.mockResolvedValue(null);
    const { status } = await patch(buildApp(), "/api/agenda/appointments/nope", { status: "Pendiente" });
    expect(status).toBe(404);
    expect(mockApptUpdate).not.toHaveBeenCalled();
  });

  it("400 con status inválido, sin tocar la BD", async () => {
    const { status } = await patch(buildApp(), "/api/agenda/appointments/appt-1", { status: "Fantasma" });
    expect(status).toBe(400);
    expect(mockApptFindUnique).not.toHaveBeenCalled();
    expect(mockApptUpdate).not.toHaveBeenCalled();
  });

  it("PATCH solo status → 200, actualiza fila, no llama a Google sin gcalEventId", async () => {
    mockApptFindUnique.mockResolvedValue({ ...BASE_ROW });
    mockApptUpdate.mockResolvedValue({ ...BASE_ROW, status: "Completada" });

    const { status, body } = await patch(buildApp(), "/api/agenda/appointments/appt-1", { status: "Completada" });

    expect(status).toBe(200);
    expect(mockApptUpdate).toHaveBeenCalledWith({
      where: { id: "appt-1" },
      data: { status: "Completada" },
    });
    expect(body).toEqual({
      id: "appt-1",
      date: "2026-07-10",
      time: "09:00",
      client: "Clínica Norte",
      service: "Consultoría",
      owner: "3A Estudio",
      status: "Completada",
      notes: "nota original",
    });
    expect(mockUpdateEvent).not.toHaveBeenCalled();
    expect(mockIntegrationFindUnique).not.toHaveBeenCalled();
  });

  it("PATCH con gcalEventId + integración conectada → llama updateEvent con el token", async () => {
    const row = { ...BASE_ROW, gcalEventId: "gcal-evt-1" };
    mockApptFindUnique.mockResolvedValue(row);
    mockApptUpdate.mockResolvedValue({
      ...row,
      startAt: new Date("2026-07-10T11:00:00"),
      endAt: new Date("2026-07-10T11:30:00"),
    });
    mockIntegrationFindUnique.mockResolvedValue({ id: "pint-1", provider: "google" });
    mockGetValidPlatformToken.mockResolvedValue("valid-token");
    mockUpdateEvent.mockResolvedValue({ ok: true, id: "gcal-evt-1" });

    const { status, body } = await patch(buildApp(), "/api/agenda/appointments/appt-1", { time: "11:00" });

    expect(status).toBe(200);
    // Recalcula startAt con la date existente y conserva la duración (30 min)
    expect(mockApptUpdate).toHaveBeenCalledWith({
      where: { id: "appt-1" },
      data: {
        startAt: new Date("2026-07-10T11:00:00"),
        endAt: new Date("2026-07-10T11:30:00"),
      },
    });
    expect(mockGetValidPlatformToken).toHaveBeenCalledWith("google");
    expect(mockUpdateEvent).toHaveBeenCalledWith("valid-token", "gcal-evt-1", {
      title: "Clínica Norte - Consultoría",
      startIso: new Date("2026-07-10T11:00:00").toISOString(),
      endIso: new Date("2026-07-10T11:30:00").toISOString(),
      description: "nota original",
    });
    expect(body.time).toBe("11:00");
    expect(body.gcalEventId).toBe("gcal-evt-1");
  });

  it("si Google falla, la respuesta sigue siendo 200 (sync best-effort)", async () => {
    const row = { ...BASE_ROW, gcalEventId: "gcal-evt-1" };
    mockApptFindUnique.mockResolvedValue(row);
    mockApptUpdate.mockResolvedValue({ ...row, client: "Innova Legal" });
    mockIntegrationFindUnique.mockResolvedValue({ id: "pint-1", provider: "google" });
    mockGetValidPlatformToken.mockResolvedValue("valid-token");
    mockUpdateEvent.mockRejectedValue(new Error("Calendar API 500"));

    const { status, body } = await patch(buildApp(), "/api/agenda/appointments/appt-1", { client: "Innova Legal" });

    expect(status).toBe(200);
    expect(body.client).toBe("Innova Legal");
  });

  it("400 con date/time inválidos", async () => {
    mockApptFindUnique.mockResolvedValue({ ...BASE_ROW });
    const { status } = await patch(buildApp(), "/api/agenda/appointments/appt-1", { date: "nope" });
    expect(status).toBe(400);
    expect(mockApptUpdate).not.toHaveBeenCalled();
  });
});
