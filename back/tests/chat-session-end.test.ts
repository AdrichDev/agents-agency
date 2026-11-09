/**
 * S2 (conversation-persistence, T1) — `POST /api/chat/session-end`.
 *
 * El widget avisa de que el visitante cerró la sesión. Contrato que se fija aquí:
 *  - es PÚBLICO (lo llama el navegador del visitante, sin sesión) y siempre responde 204:
 *    ni 404 ni 403, para no confirmar si un conversationId existe (§S2: sin filtrar existencia);
 *  - marca `metadata.session.closedAt` con un merge FRESCO, así que no pisa `leadFlow` ni el
 *    flag `handoff` que escribieron las herramientas durante los turnos;
 *  - es idempotente: la segunda llamada no reescribe ni mueve el `closedAt` original;
 *  - sólo toca conversaciones del widget: el hilo de un canal (telegram/whatsapp) es de por vida
 *    del contacto y no se cierra por esta señal (mismo 204, sin cambios);
 *  - una petición malformada es 400 (no filtra nada del recurso: no llega a consultarlo).
 *
 * Mismo montaje que tests/metering-chat-route.test.ts (servidor HTTP real sobre el router).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn(), updateMany: vi.fn() },
    conversation: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/agent/engine", () => ({ chatWithAgent: vi.fn() }));

import { prisma } from "@/lib/db";
import { chatWithAgent } from "@/lib/agent/engine";
import { aiRouter } from "@/routes/ai";
import { isPublic } from "@/lib/public-routes";
import { HttpError } from "@/lib/http";

const mockFindAgent = prisma.agent.findUnique as ReturnType<typeof vi.fn>;
const mockConvFindUnique = prisma.conversation.findUnique as ReturnType<typeof vi.fn>;
const mockConvUpdate = prisma.conversation.update as ReturnType<typeof vi.fn>;
const mockChat = chatWithAgent as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", aiRouter);
  return app;
}

function rawRequest(
  app: express.Express,
  method: string,
  path: string,
  payload?: unknown
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const headers: Record<string, string> = {};
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }
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
          resolve({ status: res.statusCode ?? 0, body: parsed, raw: data });
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

const postSessionEnd = (payload: unknown) =>
  rawRequest(buildApp(), "POST", "/api/chat/session-end", payload);

/** Metadata escrita por la ruta en la última llamada a `update`. */
function writtenMetadata() {
  return (mockConvUpdate.mock.calls.at(-1)![0] as { data: { metadata: Record<string, any> } }).data
    .metadata;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindAgent.mockResolvedValue({ id: "a1", publicKey: "pk-1", tenantId: "tenant-1" });
  mockConvUpdate.mockResolvedValue({});
});

describe("premisa: la señal de cierre es pública", () => {
  it("POST /api/chat/session-end está en la allowlist pública", () => {
    expect(isPublic("POST", "/api/chat/session-end")).toBe(true);
  });
});

describe("POST /api/chat/session-end", () => {
  it("marca la conversación como cerrada y responde 204", async () => {
    mockConvFindUnique.mockResolvedValue({
      id: "conv-1",
      channel: "widget",
      metadata: { leadFlow: { step: "assisting" }, handoff: true },
    });

    const res = await postSessionEnd({ conversationId: "conv-1" });

    expect(res.status).toBe(204);
    expect(res.raw).toBe("");

    const meta = writtenMetadata();
    expect(meta.leadFlow).toEqual({ step: "assisting" });
    expect(meta.handoff).toBe(true);
    expect(typeof meta.session.closedAt).toBe("string");
    expect(Number.isFinite(Date.parse(meta.session.closedAt))).toBe(true);
  });

  it("es idempotente: la segunda llamada no toca el closedAt original", async () => {
    const closedAt = "2026-06-01T10:00:00.000Z";
    mockConvFindUnique.mockResolvedValue({
      id: "conv-1",
      channel: "widget",
      metadata: { session: { closedAt } },
    });

    const res = await postSessionEnd({ conversationId: "conv-1" });

    expect(res.status).toBe(204);
    expect(mockConvUpdate).not.toHaveBeenCalled();
  });

  it("un conversationId desconocido también es 204 y no escribe nada", async () => {
    mockConvFindUnique.mockResolvedValue(null);

    const res = await postSessionEnd({ conversationId: "no-existe" });

    expect(res.status).toBe(204);
    expect(mockConvUpdate).not.toHaveBeenCalled();
  });

  it("una conversación de telegram no se cierra por esta señal (204, sin cambios)", async () => {
    mockConvFindUnique.mockResolvedValue({
      id: "conv-tg",
      channel: "telegram",
      metadata: {},
    });

    const res = await postSessionEnd({ conversationId: "conv-tg" });

    expect(res.status).toBe(204);
    expect(mockConvUpdate).not.toHaveBeenCalled();
  });

  it("una conversación de whatsapp tampoco", async () => {
    mockConvFindUnique.mockResolvedValue({ id: "conv-wa", channel: "whatsapp", metadata: {} });

    const res = await postSessionEnd({ conversationId: "conv-wa" });

    expect(res.status).toBe(204);
    expect(mockConvUpdate).not.toHaveBeenCalled();
  });

  it("un cuerpo inválido es 400 y no consulta la BD", async () => {
    for (const payload of [
      {},
      { conversationId: "" },
      { conversationId: 123 },
      { conversationId: "a".repeat(65) },
      { conversationId: "../../etc/passwd" },
    ]) {
      const res = await postSessionEnd(payload);
      expect(res.status, JSON.stringify(payload)).toBe(400);
    }
    expect(mockConvFindUnique).not.toHaveBeenCalled();
    expect(mockConvUpdate).not.toHaveBeenCalled();
  });

  it("un fallo de la BD no rompe la respuesta (best-effort, 204)", async () => {
    mockConvFindUnique.mockRejectedValue(new Error("connection lost"));

    const res = await postSessionEnd({ conversationId: "conv-1" });

    expect(res.status).toBe(204);
  });
});

describe("POST /api/chat — superficie del error para el visitante", () => {
  it("la caducidad llega al widget como 410 y sin texto interno", async () => {
    mockChat.mockRejectedValue(
      new HttpError(410, "La conversación ha caducado por inactividad.", "CONVERSATION_EXPIRED")
    );

    const res = await rawRequest(buildApp(), "POST", "/api/chat", {
      publicKey: "pk-1",
      message: "hola",
      conversationId: "conv-1",
    });

    // El status es lo que el widget interpreta como "sesión nueva".
    expect(res.status).toBe(410);
    // Y el texto sigue saliendo de la tabla del visitante: nada de conceptos internos.
    expect(res.body.error).toBe("Este asistente no está disponible en este momento.");
    expect(res.body.error).not.toMatch(/caduc|conversaci|sesi/i);
  });

  it("el resto de fallos del chat no cambian de superficie (404 sin agente)", async () => {
    mockFindAgent.mockResolvedValue(null);

    const res = await rawRequest(buildApp(), "POST", "/api/chat", { publicKey: "pk-x", message: "hola" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Este asistente no está disponible en este momento.");
  });
});
