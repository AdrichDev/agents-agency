/**
 * calendar-route.test.ts — aa-agenda-google-import (T1 + T2, revisado tras
 * corrección de diseño: PlatformIntegration separada de Integration).
 *
 * Covers:
 *  - GET /api/calendar/status / /events leen PlatformIntegration (sin agentId)
 *  - GET /api/oauth/:provider/url (por-agente, SIN cambios, agentId requerido)
 *  - GET /api/oauth/platform/:provider/url (plataforma, sin agentId)
 *
 * Pattern: minimal Express app mounting the routers directly (no index.ts),
 * mocked prisma / oauth / calendar libs. Mirrors profile.test.ts approach.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    integration: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
    platformIntegration: { findUnique: vi.fn() },
    agent: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/integrations/oauth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/integrations/oauth")>();
  return {
    ...actual,
    getValidPlatformToken: vi.fn(),
    authorizationUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?mock=1&scope=agent"),
    authorizationUrlPlatform: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?mock=1&scope=platform"),
  };
});

vi.mock("@/lib/integrations/calendar", () => ({
  listEventsRange: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { getValidPlatformToken, authorizationUrl, authorizationUrlPlatform } from "@/lib/integrations/oauth";
import { listEventsRange } from "@/lib/integrations/calendar";
import { calendarRouter } from "@/routes/calendar";
import { integrationsRouter } from "@/routes/integrations";
import { errorHandler } from "@/lib/observability";

const mockFindUniquePlatform = prisma.platformIntegration.findUnique as ReturnType<typeof vi.fn>;
const mockGetValidPlatformToken = getValidPlatformToken as ReturnType<typeof vi.fn>;
const mockAuthorizationUrl = authorizationUrl as ReturnType<typeof vi.fn>;
const mockAuthorizationUrlPlatform = authorizationUrlPlatform as ReturnType<typeof vi.fn>;
const mockListEventsRange = listEventsRange as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/calendar", calendarRouter);
  app.use("/api", integrationsRouter);
  app.use(errorHandler);
  return app;
}

async function request(app: express.Express, path: string) {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/calendar/status", () => {
  it("connected=true con accountLabel usando PlatformIntegration (no Integration)", async () => {
    mockFindUniquePlatform.mockResolvedValue({
      id: "pint-1",
      provider: "google",
      metadata: { email: "achozas9@gmail.com" },
    });
    const { status, body } = await request(buildApp(), "/api/calendar/status");
    expect(status).toBe(200);
    expect(body).toEqual({ connected: true, accountLabel: "achozas9@gmail.com" });
    expect(mockFindUniquePlatform).toHaveBeenCalledWith({ where: { provider: "google" } });
  });

  it("connected=false sin integración de plataforma", async () => {
    mockFindUniquePlatform.mockResolvedValue(null);
    const { status, body } = await request(buildApp(), "/api/calendar/status");
    expect(status).toBe(200);
    expect(body).toEqual({ connected: false, accountLabel: null });
  });
});

describe("GET /api/calendar/events", () => {
  const RANGE = "from=2026-07-01T00:00:00.000Z&to=2026-07-31T23:59:59.000Z";

  it("400 sin from/to", async () => {
    const { status } = await request(buildApp(), "/api/calendar/events");
    expect(status).toBe(400);
  });

  it("400 con fechas inválidas", async () => {
    const { status } = await request(buildApp(), "/api/calendar/events?from=nope&to=2026-07-31");
    expect(status).toBe(400);
  });

  it("409 sin integración de plataforma", async () => {
    mockFindUniquePlatform.mockResolvedValue(null);
    const { status } = await request(buildApp(), `/api/calendar/events?${RANGE}`);
    expect(status).toBe(409);
  });

  it("devuelve eventos normalizados vía getValidPlatformToken (sin agentId)", async () => {
    mockFindUniquePlatform.mockResolvedValue({ id: "pint-1", provider: "google", metadata: {} });
    mockGetValidPlatformToken.mockResolvedValue("valid-token");
    const events = [
      { id: "evt-1", title: "Reunión 3A", start: "2026-07-10T09:00:00Z", end: "2026-07-10T10:00:00Z", allDay: false },
    ];
    mockListEventsRange.mockResolvedValue(events);

    const { status, body } = await request(buildApp(), `/api/calendar/events?${RANGE}`);
    expect(status).toBe(200);
    expect(body).toEqual({ events });
    expect(mockGetValidPlatformToken).toHaveBeenCalledWith("google");
  });

  it("502 si Google falla", async () => {
    mockFindUniquePlatform.mockResolvedValue({ id: "pint-1", provider: "google", metadata: {} });
    mockGetValidPlatformToken.mockResolvedValue("valid-token");
    mockListEventsRange.mockRejectedValue(new Error("Calendar API 500"));
    const { status } = await request(buildApp(), `/api/calendar/events?${RANGE}`);
    expect(status).toBe(502);
  });
});

describe("GET /api/oauth/:provider/url (por-agente, sin cambios)", () => {
  it("400 sin agentId — ya NO se resuelve al azar", async () => {
    const { status } = await request(buildApp(), "/api/oauth/google/url");
    expect(status).toBe(400);
    expect(mockAuthorizationUrl).not.toHaveBeenCalled();
  });

  it("200 con agentId explícito, usa el flujo por-agente", async () => {
    const { status, body } = await request(buildApp(), "/api/oauth/google/url?agentId=agent-explicit") as { status: number; body: { url: string } };
    expect(status).toBe(200);
    expect(body.url).toContain("scope=agent");
    expect(mockAuthorizationUrl).toHaveBeenCalledWith("google", "agent-explicit");
  });
});

describe("GET /api/oauth/platform/:provider/url (plataforma, single-tenant)", () => {
  it("200 sin agentId, usa el flujo de plataforma", async () => {
    const { status, body } = await request(buildApp(), "/api/oauth/platform/google/url") as { status: number; body: { url: string } };
    expect(status).toBe(200);
    expect(body.url).toContain("scope=platform");
    expect(mockAuthorizationUrlPlatform).toHaveBeenCalledWith("google");
  });
});
