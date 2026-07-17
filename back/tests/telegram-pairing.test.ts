/**
 * aa-telegram-chatid-autocaptura — F1 (helpers de pairing) + F2 (rutas).
 *
 * F1 (T1.1): set/get/clear del pairing por merge superficial (no pisa
 *   telegramChatId/events); timingSafeEqualStr constante.
 * F2 (T2.1): POST /telegram/pairing-token → link con botUsername + token
 *   guardado; 400 sin conexión.
 * F2 (T2.2): GET /telegram/pairing-status → {linked, chatId?} sin fugar el token.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    channelConnection: { findUnique: vi.fn() },
    agentDataBackend: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
// El router importa el service completo (fuera de scope aquí).
vi.mock("@/lib/agent/service", () => ({
  listAgents: vi.fn(),
  createAgent: vi.fn(),
  getAgentDetail: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  updateWidgetConfig: vi.fn(),
  updateEcommerceConfig: vi.fn(),
  listAgentLeads: vi.fn(),
  recheckOpenclawProvisioning: vi.fn(),
  setAgentSkills: vi.fn(),
}));
vi.mock("@/lib/agent-backend/provisioning", () => ({
  provisionManagedDbBackend: vi.fn(),
}));
// Sin red: decryptCreds/validateToken solo se usan en la recuperación opcional.
vi.mock("@/lib/channels/webhook-shared", () => ({ decryptCreds: vi.fn() }));
vi.mock("@/lib/channels/telegram", () => ({ validateToken: vi.fn() }));

import { prisma } from "@/lib/db";
import { agentsRouter } from "@/routes/agents";
import { HttpError } from "@/lib/http";
import {
  setPairing,
  getPairing,
  clearPairing,
  timingSafeEqualStr,
  PAIRING_TTL_MS,
} from "@/lib/channels/telegram-pairing";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message });
  });
  return app;
}

function rawRequest(app: express.Express, method: string, path: string, payload?: unknown) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const body = payload ? JSON.stringify(payload) : undefined;
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: body
            ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) }
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
      if (body) req.write(body);
      req.end();
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── F1 — helpers de pairing ──────────────────────────────────────────────────
describe("F1 — helpers de pairing (JSON, merge superficial)", () => {
  it("setPairing guarda token+expiry SIN pisar telegramChatId/events", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({
      agentId: "ag-1",
      notificationConfig: { telegramChatId: "999", events: ["nuevo_lead"] },
    });
    asMock(prisma.agentDataBackend.update).mockImplementation(async ({ data }: any) => ({
      notificationConfig: data.notificationConfig,
    }));

    const before = Date.now();
    const pairing = await setPairing("ag-1");

    expect(typeof pairing.token).toBe("string");
    expect(pairing.token.length).toBeGreaterThanOrEqual(32);
    const expiry = new Date(pairing.expiresAt).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + PAIRING_TTL_MS - 5000);

    const written = asMock(prisma.agentDataBackend.update).mock.calls[0][0].data.notificationConfig;
    // Merge: conserva claves ajenas y añade telegramPairing.
    expect(written.telegramChatId).toBe("999");
    expect(written.events).toEqual(["nuevo_lead"]);
    expect(written.telegramPairing).toEqual({ token: pairing.token, expiresAt: pairing.expiresAt });
  });

  it("getPairing devuelve el pairing vigente y null si no existe/mal formado", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValueOnce({
      notificationConfig: { telegramPairing: { token: "t", expiresAt: "2030-01-01T00:00:00.000Z" } },
    });
    expect(await getPairing("ag-1")).toEqual({ token: "t", expiresAt: "2030-01-01T00:00:00.000Z" });

    asMock(prisma.agentDataBackend.findUnique).mockResolvedValueOnce({ notificationConfig: {} });
    expect(await getPairing("ag-1")).toBeNull();

    asMock(prisma.agentDataBackend.findUnique).mockResolvedValueOnce(null);
    expect(await getPairing("ag-1")).toBeNull();
  });

  it("clearPairing borra telegramPairing y conserva el resto", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({
      notificationConfig: {
        telegramChatId: "999",
        events: ["handoff"],
        telegramPairing: { token: "t", expiresAt: "2030-01-01T00:00:00.000Z" },
      },
    });
    asMock(prisma.agentDataBackend.update).mockImplementation(async ({ data }: any) => ({
      notificationConfig: data.notificationConfig,
    }));

    await clearPairing("ag-1");
    const written = asMock(prisma.agentDataBackend.update).mock.calls[0][0].data.notificationConfig;
    expect(written).toEqual({ telegramChatId: "999", events: ["handoff"] });
    expect(written.telegramPairing).toBeUndefined();
  });

  it("timingSafeEqualStr: igual→true, distinto→false, longitud distinta→false", () => {
    expect(timingSafeEqualStr("abc123", "abc123")).toBe(true);
    expect(timingSafeEqualStr("abc123", "abc124")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcdef")).toBe(false); // longitudes distintas → false sin throw
  });
});

// ── F2 — rutas ───────────────────────────────────────────────────────────────
describe("F2 — POST /api/agents/:id/telegram/pairing-token", () => {
  it("Telegram conectado → devuelve link con botUsername + guarda el token", async () => {
    asMock(prisma.channelConnection.findUnique).mockResolvedValue({
      agentId: "ag-1",
      provider: "telegram",
      botUsername: "MiNegocioBot",
      credentials: "enc",
    });
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({
      notificationConfig: { telegramChatId: "111", events: ["nuevo_lead"] },
    });
    asMock(prisma.agentDataBackend.update).mockImplementation(async ({ data }: any) => ({
      notificationConfig: data.notificationConfig,
    }));

    const res = await rawRequest(buildApp(), "POST", "/api/agents/ag-1/telegram/pairing-token");

    expect(res.status).toBe(200);
    expect(res.body.link).toMatch(/^https:\/\/t\.me\/MiNegocioBot\?start=.+/);
    expect(typeof res.body.expiresAt).toBe("string");

    // El token del link es exactamente el guardado en config (single source).
    const written = asMock(prisma.agentDataBackend.update).mock.calls[0][0].data.notificationConfig;
    const linkToken = res.body.link.split("start=")[1];
    expect(written.telegramPairing.token).toBe(linkToken);
    // Merge: no pisó telegramChatId/events.
    expect(written.telegramChatId).toBe("111");
    expect(written.events).toEqual(["nuevo_lead"]);
  });

  it("sin conexión Telegram → 400 'Conecta primero el bot de Telegram'", async () => {
    asMock(prisma.channelConnection.findUnique).mockResolvedValue(null);

    const res = await rawRequest(buildApp(), "POST", "/api/agents/ag-1/telegram/pairing-token");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Conecta primero el bot de Telegram");
    expect(prisma.agentDataBackend.update).not.toHaveBeenCalled();
  });
});

describe("F2 — GET /api/agents/:id/telegram/pairing-status", () => {
  it("linked=true con chatId cuando hay telegramChatId; NUNCA devuelve el token", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({
      notificationConfig: {
        telegramChatId: "12345",
        telegramPairing: { token: "SECRET-TOKEN", expiresAt: "2030-01-01T00:00:00.000Z" },
      },
    });

    const res = await rawRequest(buildApp(), "GET", "/api/agents/ag-1/telegram/pairing-status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: true, chatId: "12345" });
    expect(JSON.stringify(res.body)).not.toContain("SECRET-TOKEN");
    expect(res.body.token).toBeUndefined();
    expect(res.body.telegramPairing).toBeUndefined();
  });

  it("linked=false sin chatId", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({ notificationConfig: {} });

    const res = await rawRequest(buildApp(), "GET", "/api/agents/ag-1/telegram/pairing-status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: false });
    expect(res.body.chatId).toBeUndefined();
  });
});
