/**
 * agenda-appointments-contact.test.ts — aa-agenda-crm-parity (T9).
 *
 * Covers email/phone opcionales en PlatformAppointment + contactSummary:
 *  - POST con email/phone → los persiste y los devuelve
 *  - GET con cita que matchea Tenant por email → contactSummary del tenant
 *  - GET con cita que matchea ProspectContact (sin Tenant) → contactSummary del prospect
 *  - GET sin match ni email/phone → contactSummary fallback (no rompe)
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
    platformAppointment: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    platformIntegration: { findUnique: vi.fn() },
    tenant: { findFirst: vi.fn() },
    prospectContact: { findFirst: vi.fn() },
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
import { agendaAppointmentsRouter } from "@/routes/agenda-appointments";
import { errorHandler } from "@/lib/observability";

const mockApptFindMany = prisma.platformAppointment.findMany as ReturnType<typeof vi.fn>;
const mockApptCreate = prisma.platformAppointment.create as ReturnType<typeof vi.fn>;
const mockIntegrationFindUnique = prisma.platformIntegration.findUnique as ReturnType<typeof vi.fn>;
const mockTenantFindFirst = prisma.tenant.findFirst as ReturnType<typeof vi.fn>;
const mockProspectFindFirst = prisma.prospectContact.findFirst as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agenda", agendaAppointmentsRouter);
  app.use(errorHandler);
  return app;
}

async function request(app: express.Express, method: string, path: string, body?: unknown) {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
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
  notes: null as string | null,
  status: "Confirmada",
  email: null as string | null,
  phone: null as string | null,
  gcalEventId: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/agenda/appointments con contacto (T9)", () => {
  it("persiste email/phone opcionales y los devuelve en la respuesta", async () => {
    mockIntegrationFindUnique.mockResolvedValue(null);
    mockApptCreate.mockImplementation(async ({ data }: any) => ({
      ...BASE_ROW,
      ...data,
      id: "appt-new",
    }));

    const { status, body } = await request(buildApp(), "POST", "/api/agenda/appointments", {
      date: "2026-07-10",
      time: "09:00",
      client: "Clínica Norte",
      email: "norte@clinica.es",
      phone: "+34 600 111 222",
    });

    expect(status).toBe(201);
    expect(mockApptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: "norte@clinica.es", phone: "+34 600 111 222" }),
    });
    expect(body.email).toBe("norte@clinica.es");
    expect(body.phone).toBe("+34 600 111 222");
  });
});

describe("GET /api/agenda/appointments — contactSummary (T9)", () => {
  it("cita con email que matchea un Tenant → contactSummary con datos del tenant", async () => {
    mockApptFindMany.mockResolvedValue([{ ...BASE_ROW, email: "norte@clinica.es" }]);
    mockTenantFindFirst.mockResolvedValue({
      id: "ten-1",
      name: "Clínica Norte S.L.",
      contactPerson: "Dra. Elisa Martínez",
      phone: "+34 600 111 222",
      direccion: "Paseo de la Castellana 45, Madrid",
    });

    const { status, body } = await request(buildApp(), "GET", "/api/agenda/appointments");

    expect(status).toBe(200);
    expect(mockTenantFindFirst).toHaveBeenCalledWith({
      where: { OR: [{ email: "norte@clinica.es" }] },
    });
    expect(mockProspectFindFirst).not.toHaveBeenCalled();
    expect(body[0].contactSummary).toEqual({
      commercialName: "Clínica Norte S.L.",
      contactPerson: "Dra. Elisa Martínez",
      phone: "+34 600 111 222",
      address: "Paseo de la Castellana 45, Madrid",
    });
    expect(body[0].email).toBe("norte@clinica.es");
  });

  it("sin match en Tenant pero sí en ProspectContact → contactSummary del prospect", async () => {
    mockApptFindMany.mockResolvedValue([{ ...BASE_ROW, phone: "+34 600 333 444" }]);
    mockTenantFindFirst.mockResolvedValue(null);
    mockProspectFindFirst.mockResolvedValue({
      id: "pc-1",
      name: "Innova Legal",
      phone: "+34 600 333 444",
      direccion: null,
    });

    const { status, body } = await request(buildApp(), "GET", "/api/agenda/appointments");

    expect(status).toBe(200);
    expect(mockProspectFindFirst).toHaveBeenCalledWith({
      where: { OR: [{ phone: "+34 600 333 444" }] },
    });
    expect(body[0].contactSummary).toEqual({
      commercialName: "Innova Legal",
      phone: "+34 600 333 444",
    });
    expect(body[0].phone).toBe("+34 600 333 444");
  });

  it("sin email/phone → contactSummary fallback con el nombre libre, sin consultar BD de contactos", async () => {
    mockApptFindMany.mockResolvedValue([{ ...BASE_ROW }]);

    const { status, body } = await request(buildApp(), "GET", "/api/agenda/appointments");

    expect(status).toBe(200);
    expect(mockTenantFindFirst).not.toHaveBeenCalled();
    expect(mockProspectFindFirst).not.toHaveBeenCalled();
    expect(body[0].contactSummary).toEqual({ commercialName: "Clínica Norte" });
    expect(body[0].email).toBeUndefined();
    expect(body[0].phone).toBeUndefined();
  });
});
