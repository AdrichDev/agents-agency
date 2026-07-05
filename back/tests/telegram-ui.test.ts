import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const prismaMock = vi.hoisted(() => ({
  conversation: { findMany: vi.fn(), findUnique: vi.fn() },
  message: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  channelConnection: { findUnique: vi.fn() },
}));

const tgMock = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  validateToken: vi.fn(),
  registerWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
}));

const sharedMock = vi.hoisted(() => ({
  decryptCreds: vi.fn(() => ({ token: "mock-bot-token" })),
  encryptCreds: vi.fn(),
  PUBLIC_URL: () => "https://aa.example.com",
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/channels/telegram", () => tgMock);
vi.mock("@/lib/channels/webhook-shared", () => sharedMock);

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

describe("Telegram UI Endpoints", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    const { channelsRouter } = await import("@/routes/channels");
    app = express();
    app.use(express.json());
    app.use("/api/channels", channelsRouter);
  });

  it("GET /api/channels/telegram/conversations - should return Telegram conversations", async () => {
    const mockConversations = [
      {
        id: "conv-1",
        channel: "telegram",
        agent: { name: "Agent 1" },
        lead: { customerName: "Client A" },
        messages: [{ id: "msg-1", content: "Hola", createdAt: new Date().toISOString() }],
      },
    ];
    prismaMock.conversation.findMany.mockResolvedValue(mockConversations);

    const res = await request(app, "GET", "/api/channels/telegram/conversations");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("conv-1");
    expect(prismaMock.conversation.findMany).toHaveBeenCalled();
  });

  it("GET /api/channels/telegram/conversations/:id/messages - should return messages", async () => {
    const mockMessages = [
      { id: "msg-1", conversationId: "conv-1", content: "Hola", role: "user" },
    ];
    prismaMock.message.findMany.mockResolvedValue(mockMessages);

    const res = await request(app, "GET", "/api/channels/telegram/conversations/conv-1/messages");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].content).toBe("Hola");
  });

  it("POST /api/channels/telegram/conversations/:id/messages - should send manual message and return it", async () => {
    const mockConv = {
      id: "conv-1",
      agentId: "agent-1",
      metadata: { telegramChatId: 123456 },
    };
    prismaMock.conversation.findUnique.mockResolvedValue(mockConv);
    prismaMock.channelConnection.findUnique.mockResolvedValue({
      credentials: "encrypted-creds",
    });
    tgMock.sendMessage.mockResolvedValue({ ok: true });
    prismaMock.message.create.mockResolvedValue({
      id: "msg-2",
      conversationId: "conv-1",
      role: "assistant",
      content: "Respuesta manual",
    });

    const res = await request(app, "POST", "/api/channels/telegram/conversations/conv-1/messages", {
      content: "Respuesta manual",
    });

    expect(res.status).toBe(200);
    expect(res.body.content).toBe("Respuesta manual");
    expect(tgMock.sendMessage).toHaveBeenCalledWith("mock-bot-token", 123456, "Respuesta manual");
    expect(prismaMock.message.create).toHaveBeenCalled();
  });

  it("POST /api/channels/telegram/conversations/:id/messages - should resolve with idempotency if messageId already exists", async () => {
    const existingMsg = {
      id: "client-msg-id-123",
      conversationId: "conv-1",
      role: "assistant",
      content: "Respuesta manual ya enviada",
    };
    prismaMock.message.findUnique.mockResolvedValue(existingMsg);

    const res = await request(app, "POST", "/api/channels/telegram/conversations/conv-1/messages", {
      content: "Respuesta manual ya enviada",
      clientMsgId: "client-msg-id-123",
    });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("client-msg-id-123");
    expect(tgMock.sendMessage).not.toHaveBeenCalled();
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });
});
