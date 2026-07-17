/**
 * T2.1-T2.5 (aa-lead-whatsapp-kickoff F2, design.md §C, validation.md) —
 * endpoint `POST /api/leads/kickoff`. Prisma + webhook-shared + adapter +
 * sendTemplate mockeados (sin red ni BD real):
 *  - T2.1 gate: token inválido/ausente → 401; body inválido → 422; limiter wired.
 *  - T2.2 creds: sin ChannelConnection → 409.
 *  - T2.3 idempotencia: conversación previa → `already_started`, sin reenviar.
 *  - T2.4 Contacto: `guardarLead` llamado; adapter null → sigue enviando.
 *  - T2.5 plantilla+siembra: happy 200 (Conversation+Message); Graph fail → 502, 0 filas.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    agentDataBackend: { findUnique: vi.fn() },
    channelConnection: { findUnique: vi.fn() },
    conversation: { create: vi.fn() },
    message: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/channels/webhook-shared", () => ({
  decryptCreds: vi.fn(),
  resolveConversation: vi.fn(),
}));
vi.mock("@/lib/channels/whatsapp", () => ({
  sendTemplate: vi.fn(),
}));
vi.mock("@/lib/agent-backend/managed-db", () => ({
  resolveAgentBackendAdapter: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { decryptCreds, resolveConversation } from "@/lib/channels/webhook-shared";
import { sendTemplate } from "@/lib/channels/whatsapp";
import { resolveAgentBackendAdapter } from "@/lib/agent-backend/managed-db";
import { leadsRouter } from "@/routes/leads";
import { leadsLimiter } from "@/lib/limiters";
import { HttpError } from "@/lib/http";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/leads", leadsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message });
  });
  return app;
}

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

const TOKEN = "kickoff-secret-token";
const BACKEND = { notificationConfig: { kickoffToken: TOKEN } };
const CONN = { credentials: { iv: "x", authTag: "y", data: "z" } };
const CREDS = { phoneNumberId: "PID", accessToken: "AT", verifyToken: "VT" };
const VALID_BODY = {
  agentId: "a1",
  nombre: "Ana",
  telefono: "+34 600 111 222",
  token: TOKEN,
};

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.agentDataBackend.findUnique).mockResolvedValue(BACKEND);
  asMock(prisma.channelConnection.findUnique).mockResolvedValue(CONN);
  asMock(prisma.conversation.create).mockResolvedValue({ id: "conv-1" });
  asMock(prisma.message.create).mockResolvedValue({ id: "msg-1" });
  asMock(decryptCreds).mockReturnValue(CREDS);
  asMock(resolveConversation).mockResolvedValue(undefined);
  asMock(sendTemplate).mockResolvedValue(undefined);
  asMock(resolveAgentBackendAdapter).mockResolvedValue(null);
  // Advisory lock: el raw query resuelve sin bloquear; la transacción interactiva
  // ejecuta el callback pasándole el mismo cliente prisma mockeado como `tx`.
  asMock(prisma.$queryRaw).mockResolvedValue([]);
  asMock(prisma.$transaction).mockImplementation((fn: any) => fn(prisma));
});

// ── T2.1 gate ─────────────────────────────────────────────────────────────────

describe("T2.1 — gate (token + body + limiter)", () => {
  it("leadsLimiter está montado en el router /kickoff (anti-spam WhatsApp)", () => {
    const layers = (leadsRouter as any).stack.filter((l: any) => l.route?.path === "/kickoff");
    expect(layers.length).toBeGreaterThan(0);
    const handles = layers[0].route.stack.map((s: any) => s.handle);
    expect(handles).toContain(leadsLimiter);
  });

  it("token inválido → 401, sin enviar plantilla", async () => {
    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", {
      ...VALID_BODY,
      token: "wrong",
    });
    expect(res.status).toBe(401);
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it("sin token → 401 (fallo de autorización, no de validación)", async () => {
    const { token, ...noToken } = VALID_BODY;
    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", noToken);
    expect(res.status).toBe(401);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("agente sin kickoffToken configurado → 401", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({ notificationConfig: {} });
    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", VALID_BODY);
    expect(res.status).toBe(401);
  });

  it("body inválido (falta nombre) → 422", async () => {
    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", {
      agentId: "a1",
      telefono: "+34600111222",
      token: TOKEN,
    });
    expect(res.status).toBe(422);
    expect(prisma.agentDataBackend.findUnique).not.toHaveBeenCalled();
  });

  it("teléfono inválido (pocos dígitos) → 422 tras pasar el gate", async () => {
    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", {
      ...VALID_BODY,
      telefono: "123",
    });
    expect(res.status).toBe(422);
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});

// ── T2.2 creds ────────────────────────────────────────────────────────────────

describe("T2.2 — resolución de creds WhatsApp", () => {
  it("sin ChannelConnection → 409 honesto, sin enviar", async () => {
    asMock(prisma.channelConnection.findUnique).mockResolvedValue(null);
    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", VALID_BODY);
    expect(res.status).toBe(409);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("con conexión → descifra creds y las usa en sendTemplate", async () => {
    await rawRequest(buildApp(), "POST", "/api/leads/kickoff", VALID_BODY);
    expect(decryptCreds).toHaveBeenCalledWith(CONN.credentials);
    const [pid, at] = asMock(sendTemplate).mock.calls[0];
    expect(pid).toBe("PID");
    expect(at).toBe("AT");
  });
});

// ── T2.3 idempotencia ──────────────────────────────────────────────────────────

describe("T2.3 — idempotencia", () => {
  it("conversación previa → 200 already_started, NO reenvía plantilla ni siembra", async () => {
    asMock(resolveConversation).mockResolvedValue("conv-existente");
    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "already_started", conversationId: "conv-existente" });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });
});

// ── T2.4 Contacto CRM (best-effort) ─────────────────────────────────────────────

describe("T2.4 — Contacto en CRM (best-effort)", () => {
  it("con adapter → guardarLead con teléfono normalizado, y sigue enviando", async () => {
    const guardarLead = vi.fn().mockResolvedValue({ id: "lead-1", creadoEn: "now" });
    asMock(resolveAgentBackendAdapter).mockResolvedValue({ guardarLead });
    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", {
      ...VALID_BODY,
      email: "ana@x.com",
      peticion: "quiere info",
    });
    expect(res.status).toBe(200);
    expect(guardarLead).toHaveBeenCalledWith(
      { nombre: "Ana", email: "ana@x.com", telefono: "+34600111222" },
      "quiere info"
    );
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("adapter que lanza (p. ej. capability leads deshabilitada) NO bloquea el WhatsApp", async () => {
    const guardarLead = vi.fn().mockRejectedValue(new Error("capability leads no habilitada"));
    asMock(resolveAgentBackendAdapter).mockResolvedValue({ guardarLead });
    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", VALID_BODY);
    expect(res.status).toBe(200);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("adapter null → sigue enviando la plantilla", async () => {
    asMock(resolveAgentBackendAdapter).mockResolvedValue(null);
    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", VALID_BODY);
    expect(res.status).toBe(200);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });
});

// ── T2.5 plantilla + siembra ────────────────────────────────────────────────────

describe("T2.5 — envío de plantilla y siembra de conversación", () => {
  it("happy path → envía plantilla, siembra Conversation + Message assistant, 200 started", async () => {
    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "started", conversationId: "conv-1" });

    // Plantilla enviada al teléfono normalizado.
    const [, , to] = asMock(sendTemplate).mock.calls[0];
    expect(to).toBe("+34600111222");

    // Conversación sembrada con metadata canónica.
    const convArg = asMock(prisma.conversation.create).mock.calls[0][0];
    expect(convArg.data).toMatchObject({
      agentId: "a1",
      channel: "whatsapp",
      metadata: { externalId: "+34600111222", leadFlow: true, source: "kickoff" },
    });

    // Message assistant con texto renderizado.
    const msgArg = asMock(prisma.message.create).mock.calls[0][0];
    expect(msgArg.data).toMatchObject({ conversationId: "conv-1", role: "assistant" });
    expect(typeof msgArg.data.content).toBe("string");
    expect(msgArg.data.content).toContain("Ana");
  });

  it("fallo Graph API (plantilla no aprobada) → 502 y NO siembra (0 filas)", async () => {
    asMock(sendTemplate).mockRejectedValue(new Error("Error Graph API (400): not approved"));
    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", VALID_BODY);
    expect(res.status).toBe(502);
    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});

// ── T2.6 advisory lock (doble-submit concurrente) ───────────────────────────────
//
// NOTA: estos tests verifican el CONTRATO del lock con mocks (orden de llamadas +
// re-chequeo dentro del lock). La concurrencia REAL de ejecución paralela (dos
// requests carreando sobre pg_advisory_xact_lock) solo se ejercita contra una BD
// Postgres real (e2e), no con mocks — el mock serializa por construcción.

describe("T2.6 — advisory lock serializa el check→send→create", () => {
  it("adquiere pg_advisory_xact_lock con la clave del lead ANTES de enviar (create path)", async () => {
    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "started", conversationId: "conv-1" });

    // El raw query de lock se ejecutó con la clave estable del lead, parametrizada.
    const rawCalls = asMock(prisma.$queryRaw).mock.calls;
    expect(rawCalls.length).toBeGreaterThan(0);
    const [sqlStrings, keyArg] = rawCalls[0];
    expect((sqlStrings as string[]).join("?")).toContain("pg_advisory_xact_lock");
    expect(keyArg).toBe("kickoff:a1:+34600111222");

    // El lock se adquiere ANTES del envío de la plantilla.
    const lockOrder = asMock(prisma.$queryRaw).mock.invocationCallOrder[0];
    const sendOrder = asMock(sendTemplate).mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(sendOrder);
  });

  it("re-chequeo DENTRO del lock encuentra conversación → already_started, NO envía", async () => {
    // Early-check (fuera del lock) pasa; el re-chequeo dentro del lock ya la ve
    // (simula la request perdedora de la carrera: la ganadora ya sembró).
    asMock(resolveConversation)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("conv-ganadora");

    const res = await rawRequest(buildApp(), "POST", "/api/leads/kickoff", VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "already_started", conversationId: "conv-ganadora" });

    // Entró en la sección crítica (adquirió el lock) pero NO reenvió ni sembró.
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});
