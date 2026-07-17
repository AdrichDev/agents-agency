/**
 * T5 (aa-agent-backend-foundation, validation.md, AC5/AC9-config) — tab "Datos
 * del negocio" + notificaciones:
 *  - PATCH /api/agents/:id/backend persiste capabilities y notificationConfig
 *    (merge, sin pisar claves ajenas) y NUNCA expone dbUrlEncrypted.
 *  - POST /api/agents/:id/backend/provision responde honesto: 503 sin
 *    AGENT_BACKEND_ADMIN_DB_URL, 400 si el modo no es managed_db.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    agentDataBackend: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
// El router importa el service completo (storage/openclaw/scraper) — fuera de scope aquí.
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
}));
vi.mock("@/lib/agent-backend/provisioning", () => ({
  provisionManagedDbBackend: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { provisionManagedDbBackend } from "@/lib/agent-backend/provisioning";
import { agentsRouter, updateBackendSchema } from "@/routes/agents";
import { HttpError } from "@/lib/http";

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

// HTTP helper (no supertest dependency — mirrors existing test pattern).
function rawRequest(
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

const BACKEND_ROW = {
  id: "adb-1",
  agentId: "ag-1",
  mode: "managed_db",
  dbUrlEncrypted: "enc:v1:secreto",
  capabilities: ["reservas"],
  notificationConfig: { telegramChatId: "111", events: ["nuevo_lead"] },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateBackendSchema", () => {
  it("rechaza un body vacío y eventos/capabilities desconocidos", () => {
    expect(updateBackendSchema.safeParse({}).success).toBe(false);
    expect(updateBackendSchema.safeParse({ capabilities: ["facturas"] }).success).toBe(false);
    expect(
      updateBackendSchema.safeParse({ notificationConfig: { events: ["fin_del_mundo"] } }).success
    ).toBe(false);
  });

  it("acepta capabilities y notificationConfig válidos", () => {
    expect(
      updateBackendSchema.safeParse({
        capabilities: ["reservas", "leads"],
        notificationConfig: { telegramChatId: "123", events: ["nueva_reserva", "handoff"] },
      }).success
    ).toBe(true);
  });
});

describe("PATCH /api/agents/:id/backend", () => {
  it("404 si el agente no tiene fila de backend", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue(null);

    const res = await rawRequest(buildApp(), "PATCH", "/api/agents/ag-1/backend", {
      capabilities: ["reservas"],
    });

    expect(res.status).toBe(404);
  });

  it("400 si se intentan capabilities sobre none_yet", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({ ...BACKEND_ROW, mode: "none_yet" });

    const res = await rawRequest(buildApp(), "PATCH", "/api/agents/ag-1/backend", {
      capabilities: ["reservas"],
    });

    expect(res.status).toBe(400);
  });

  it("400 si external_api intenta habilitar pedidos", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({
      ...BACKEND_ROW,
      mode: "external_api",
    });

    const res = await rawRequest(buildApp(), "PATCH", "/api/agents/ag-1/backend", {
      capabilities: ["pedidos"],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("reservas, leads");
  });

  it("200 al actualizar capabilities de external_api a reservas/leads", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({
      ...BACKEND_ROW,
      mode: "external_api",
    });
    asMock(prisma.agentDataBackend.update).mockImplementation(async ({ data }: any) => ({
      ...BACKEND_ROW,
      mode: "external_api",
      ...data,
    }));

    const res = await rawRequest(buildApp(), "PATCH", "/api/agents/ag-1/backend", {
      capabilities: ["reservas", "leads"],
    });

    expect(res.status).toBe(200);
    expect(res.body.capabilities).toEqual(["reservas", "leads"]);
    expect(prisma.agentDataBackend.update).toHaveBeenCalledWith({
      where: { agentId: "ag-1" },
      data: { capabilities: ["reservas", "leads"] },
    });
  });

  it("persiste notificationConfig con MERGE y sin exponer dbUrlEncrypted", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue(BACKEND_ROW);
    asMock(prisma.agentDataBackend.update).mockImplementation(async ({ data }: any) => ({
      ...BACKEND_ROW,
      ...data,
    }));

    const res = await rawRequest(buildApp(), "PATCH", "/api/agents/ag-1/backend", {
      notificationConfig: { events: ["nueva_reserva", "nuevo_lead"] },
    });

    expect(res.status).toBe(200);
    // Merge: conserva telegramChatId existente, actualiza events
    expect(prisma.agentDataBackend.update).toHaveBeenCalledWith({
      where: { agentId: "ag-1" },
      data: {
        notificationConfig: { telegramChatId: "111", events: ["nueva_reserva", "nuevo_lead"] },
      },
    });
    expect(res.body).toEqual({
      mode: "managed_db",
      capabilities: ["reservas"],
      notificationConfig: { telegramChatId: "111", events: ["nueva_reserva", "nuevo_lead"] },
      provisioned: true,
    });
    expect(JSON.stringify(res.body)).not.toContain("enc:v1:secreto");
  });

  it("actualiza capabilities en managed_db", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue(BACKEND_ROW);
    asMock(prisma.agentDataBackend.update).mockImplementation(async ({ data }: any) => ({
      ...BACKEND_ROW,
      ...data,
    }));

    const res = await rawRequest(buildApp(), "PATCH", "/api/agents/ag-1/backend", {
      capabilities: ["reservas", "pedidos"],
    });

    expect(res.status).toBe(200);
    expect(res.body.capabilities).toEqual(["reservas", "pedidos"]);
  });

  it("200 managed_db admite las tres capabilities (regresión)", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue(BACKEND_ROW);
    asMock(prisma.agentDataBackend.update).mockImplementation(async ({ data }: any) => ({
      ...BACKEND_ROW,
      ...data,
    }));

    const res = await rawRequest(buildApp(), "PATCH", "/api/agents/ag-1/backend", {
      capabilities: ["reservas", "leads", "pedidos"],
    });

    expect(res.status).toBe(200);
    expect(res.body.capabilities).toEqual(["reservas", "leads", "pedidos"]);
  });
});

// ── F1 (aa-external-api-ui) — PATCH acepta la config del modo external_api ──────
describe("PATCH /api/agents/:id/backend — external_api (T1.1)", () => {
  it("updateBackendSchema acepta mode/apiBaseUrl/apiKey/businessId/locationId", () => {
    expect(
      updateBackendSchema.safeParse({
        mode: "external_api",
        apiBaseUrl: "https://crm.example.com",
        apiKey: "k1",
        businessId: "biz1",
        locationId: "loc1",
        capabilities: ["reservas", "leads"],
      }).success
    ).toBe(true);
    // apiBaseUrl debe ser una URL válida.
    expect(updateBackendSchema.safeParse({ apiBaseUrl: "no-es-url" }).success).toBe(false);
    // mode solo admite external_api (no se puede forzar managed_db/none_yet por aquí).
    expect(updateBackendSchema.safeParse({ mode: "managed_db" }).success).toBe(false);
  });

  it("switch none_yet → external_api: persiste apiBaseUrl, cifra apiKey y hace merge de dbSchema", async () => {
    process.env.CHANNEL_ENCRYPTION_KEY ??= "a".repeat(64);
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({
      ...BACKEND_ROW,
      mode: "none_yet",
      dbUrlEncrypted: null,
      capabilities: [],
      dbSchema: null,
    });
    asMock(prisma.agentDataBackend.update).mockImplementation(async ({ data }: any) => ({
      ...BACKEND_ROW,
      mode: "external_api",
      ...data,
    }));

    const res = await rawRequest(buildApp(), "PATCH", "/api/agents/ag-1/backend", {
      mode: "external_api",
      apiBaseUrl: "https://crm.example.com",
      apiKey: "plain-secret",
      businessId: "biz1",
      locationId: "loc1",
      capabilities: ["reservas"],
    });

    expect(res.status).toBe(200);
    const call = asMock(prisma.agentDataBackend.update).mock.calls[0][0];
    expect(call.where).toEqual({ agentId: "ag-1" });
    expect(call.data.mode).toBe("external_api");
    expect(call.data.apiBaseUrl).toBe("https://crm.example.com");
    expect(call.data.capabilities).toEqual(["reservas"]);
    expect(call.data.dbSchema).toEqual({ businessId: "biz1", locationId: "loc1" });
    // Cifrado enc:v1: — nunca en claro (AC7).
    expect(call.data.apiKeyEncrypted).toMatch(/^enc:v1:/);
    expect(call.data.apiKeyEncrypted).not.toContain("plain-secret");
    // La respuesta jamás incluye la key ni el cifrado.
    expect(JSON.stringify(res.body)).not.toContain("plain-secret");
  });

  it("write-only: apiKey vacío conserva la key existente (no toca apiKeyEncrypted)", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({
      ...BACKEND_ROW,
      mode: "external_api",
      apiKeyEncrypted: "enc:v1:existente",
      dbUrlEncrypted: null,
    });
    asMock(prisma.agentDataBackend.update).mockImplementation(async ({ data }: any) => ({
      ...BACKEND_ROW,
      mode: "external_api",
      ...data,
    }));

    const res = await rawRequest(buildApp(), "PATCH", "/api/agents/ag-1/backend", {
      apiBaseUrl: "https://nuevo.example.com",
      apiKey: "",
    });

    expect(res.status).toBe(200);
    const call = asMock(prisma.agentDataBackend.update).mock.calls[0][0];
    expect(call.data.apiBaseUrl).toBe("https://nuevo.example.com");
    // Blanco = conservar: no se envía apiKeyEncrypted al update.
    expect(call.data).not.toHaveProperty("apiKeyEncrypted");
  });

  it("400 si el switch a external_api viene con capability pedidos", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({
      ...BACKEND_ROW,
      mode: "none_yet",
      dbUrlEncrypted: null,
      capabilities: [],
    });

    const res = await rawRequest(buildApp(), "PATCH", "/api/agents/ag-1/backend", {
      mode: "external_api",
      capabilities: ["pedidos"],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("reservas, leads");
    expect(prisma.agentDataBackend.update).not.toHaveBeenCalled();
  });

  it("400 al intentar convertir managed_db → external_api (no rompe la BD provisionada)", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue(BACKEND_ROW);

    const res = await rawRequest(buildApp(), "PATCH", "/api/agents/ag-1/backend", {
      mode: "external_api",
      apiBaseUrl: "https://crm.example.com",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("gestionado");
    expect(prisma.agentDataBackend.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/agents/:id/backend/provision", () => {
  it("503 honesto cuando falta AGENT_BACKEND_ADMIN_DB_URL", async () => {
    asMock(provisionManagedDbBackend).mockResolvedValue({
      status: "unavailable",
      reason: "AGENT_BACKEND_ADMIN_DB_URL no configurada. Paso manual: ...",
    });

    const res = await rawRequest(buildApp(), "POST", "/api/agents/ag-1/backend/provision");

    expect(res.status).toBe(503);
    expect(res.body.error).toContain("AGENT_BACKEND_ADMIN_DB_URL");
  });

  it("400 si el backend no es managed_db", async () => {
    asMock(provisionManagedDbBackend).mockResolvedValue({ status: "invalid_mode", reason: "no aplica" });

    const res = await rawRequest(buildApp(), "POST", "/api/agents/ag-1/backend/provision");

    expect(res.status).toBe(400);
  });

  it("200 al aprovisionar (o si ya estaba aprovisionada)", async () => {
    asMock(provisionManagedDbBackend).mockResolvedValue({ status: "provisioned" });

    const res = await rawRequest(buildApp(), "POST", "/api/agents/ag-1/backend/provision");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("provisioned");
  });
});
