/**
 * agenda-appointments-delete.test.ts — aa-agenda-crm-parity (T7).
 *
 * Covers DELETE /api/agenda/appointments/:id:
 *  - 404 si el id no existe
 *  - DELETE sin gcalEventId → 204, borra la fila, sin llamada a Google
 *  - DELETE con gcalEventId + PlatformIntegration conectada → llama deleteEvent y borra en BD
 *  - Si Google falla, el hard-delete en BD continúa igual (best-effort, no 500)
 *
 * Pattern: minimal Express app mounting the router directly, mocked
 * prisma / oauth / calendar libs. Mirrors agenda-appointments-patch.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    platformAppointment: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    platformIntegration: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/integrations/oauth", () => ({
  getValidPlatformToken: vi.fn(),
}));

vi.mock("@/lib/integrations/calendar", () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { getValidPlatformToken } from "@/lib/integrations/oauth";
import { deleteEvent } from "@/lib/integrations/calendar";
import { agendaAppointmentsRouter } from "@/routes/agenda-appointments";
import { errorHandler } from "@/lib/observability";

const mockApptFindUnique = prisma.platformAppointment.findUnique as ReturnType<typeof vi.fn>;
const mockApptDelete = prisma.platformAppointment.delete as ReturnType<typeof vi.fn>;
const mockIntegrationFindUnique = prisma.platformIntegration.findUnique as ReturnType<typeof vi.fn>;
const mockGetValidPlatformToken = getValidPlatformToken as ReturnType<typeof vi.fn>;
const mockDeleteEvent = deleteEvent as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agenda", agendaAppointmentsRouter);
  app.use(errorHandler);
  return app;
}

async function del(app: express.Express, path: string) {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "DELETE" });
    const resBody = (await res.text()) || null;
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

describe("DELETE /api/agenda/appointments/:id", () => {
  it("404 si el id no existe", async () => {
    mockApptFindUnique.mockResolvedValue(null);
    const { status } = await del(buildApp(), "/api/agenda/appointments/nope");
    expect(status).toBe(404);
    expect(mockApptDelete).not.toHaveBeenCalled();
  });

  it("DELETE sin gcalEventId → 204, borra la fila, no llama a Google", async () => {
    mockApptFindUnique.mockResolvedValue({ ...BASE_ROW });
    mockApptDelete.mockResolvedValue({ ...BASE_ROW });

    const { status, body } = await del(buildApp(), "/api/agenda/appointments/appt-1");

    expect(status).toBe(204);
    expect(body).toBeNull();
    expect(mockApptDelete).toHaveBeenCalledWith({ where: { id: "appt-1" } });
    expect(mockDeleteEvent).not.toHaveBeenCalled();
    expect(mockIntegrationFindUnique).not.toHaveBeenCalled();
  });

  it("DELETE con gcalEventId + integración conectada → borra en Google y en BD", async () => {
    const row = { ...BASE_ROW, gcalEventId: "gcal-evt-1" };
    mockApptFindUnique.mockResolvedValue(row);
    mockIntegrationFindUnique.mockResolvedValue({ id: "pint-1", provider: "google" });
    mockGetValidPlatformToken.mockResolvedValue("valid-token");
    mockDeleteEvent.mockResolvedValue({ ok: true });
    mockApptDelete.mockResolvedValue(row);

    const { status } = await del(buildApp(), "/api/agenda/appointments/appt-1");

    expect(status).toBe(204);
    expect(mockGetValidPlatformToken).toHaveBeenCalledWith("google");
    expect(mockDeleteEvent).toHaveBeenCalledWith("valid-token", "gcal-evt-1");
    expect(mockApptDelete).toHaveBeenCalledWith({ where: { id: "appt-1" } });
  });

  it("si Google falla, el hard-delete en BD continúa (best-effort, no 500)", async () => {
    const row = { ...BASE_ROW, gcalEventId: "gcal-evt-1" };
    mockApptFindUnique.mockResolvedValue(row);
    mockIntegrationFindUnique.mockResolvedValue({ id: "pint-1", provider: "google" });
    mockGetValidPlatformToken.mockResolvedValue("valid-token");
    mockDeleteEvent.mockRejectedValue(new Error("Calendar API 500"));
    mockApptDelete.mockResolvedValue(row);

    const { status } = await del(buildApp(), "/api/agenda/appointments/appt-1");

    expect(status).toBe(204);
    expect(mockApptDelete).toHaveBeenCalledWith({ where: { id: "appt-1" } });
  });
});
