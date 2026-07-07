/**
 * Tests del endpoint de servicio POST /service/telegram/send (5.4b
 * aa-centro-mando-agenda-telegram): contrato TELEGRAM_SEND_URL del CRM.
 * Respuestas manuales del CRM salen por AA (único escritor a la Bot API),
 * con idempotencia por clientMessageId y auth por service token
 * (x-service-token, mismo esquema que /service/operator). Mismo estilo de
 * test que tests/telegram-ui.test.ts (app express real + http, sin red
 * hacia Telegram).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const prismaMock = vi.hoisted(() => ({
  conversation: { findUnique: vi.fn() },
  message: { findUnique: vi.fn(), create: vi.fn() },
  channelConnection: { findUnique: vi.fn() },
}));

const tgMock = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

const sharedMock = vi.hoisted(() => ({
  decryptCreds: vi.fn(() => ({ token: "bot-token-crm" })),
  encryptCreds: vi.fn(),
  PUBLIC_URL: () => "https://aa.example.com",
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/channels/telegram", () => tgMock);
vi.mock("@/lib/channels/webhook-shared", () => sharedMock);

const SERVICE_TOKEN = "test-service-token";

function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
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
          headers: {
            ...(payload
              ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
              : {}),
            ...headers,
          },
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

function authed(): Record<string, string> {
  return { "x-service-token": SERVICE_TOKEN };
}

const happyBody = {
  businessId: "negocio-1",
  conversationId: "conv-1",
  text: "Respuesta manual desde el CRM",
  clientMessageId: "crm-msg-1",
};

describe("POST /service/telegram/send", () => {
  let app: express.Express;
  let prevToken: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    prevToken = process.env.OPERATOR_SERVICE_TOKEN;
    process.env.OPERATOR_SERVICE_TOKEN = SERVICE_TOKEN;

    prismaMock.message.findUnique.mockResolvedValue(null);
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      agentId: "agent-1",
      metadata: { telegramChatId: 987654, externalId: "987654" },
    });
    prismaMock.channelConnection.findUnique.mockResolvedValue({ credentials: "encrypted" });
    tgMock.sendMessage.mockResolvedValue(undefined);
    prismaMock.message.create.mockResolvedValue({
      id: "crm-msg-1",
      conversationId: "conv-1",
      role: "assistant",
      content: happyBody.text,
    });

    const { serviceTelegramRouter } = await import("@/routes/service-telegram");
    app = express();
    app.use(express.json());
    app.use("/service/telegram", serviceTelegramRouter);
  });

  afterEach(() => {
    if (prevToken === undefined) delete process.env.OPERATOR_SERVICE_TOKEN;
    else process.env.OPERATOR_SERVICE_TOKEN = prevToken;
  });

  it("401 sin header x-service-token (y no toca Telegram ni BD)", async () => {
    const res = await request(app, "POST", "/service/telegram/send", happyBody);
    expect(res.status).toBe(401);
    expect(tgMock.sendMessage).not.toHaveBeenCalled();
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("401 con token incorrecto", async () => {
    const res = await request(app, "POST", "/service/telegram/send", happyBody, {
      "x-service-token": "wrong",
    });
    expect(res.status).toBe(401);
    expect(tgMock.sendMessage).not.toHaveBeenCalled();
  });

  it("happy path: envía por el bot del agente dueño y persiste el Message saliente", async () => {
    const res = await request(app, "POST", "/service/telegram/send", happyBody, authed());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("crm-msg-1");
    expect(res.body.content).toBe(happyBody.text);

    // Envío con el token descifrado de la ChannelConnection del agente de la conversación.
    expect(tgMock.sendMessage).toHaveBeenCalledWith("bot-token-crm", 987654, happyBody.text);
    expect(prismaMock.channelConnection.findUnique).toHaveBeenCalledWith({
      where: { agentId_provider: { agentId: "agent-1", provider: "telegram" } },
    });

    // Persistencia idempotente: el Message usa el clientMessageId del CRM como id.
    expect(prismaMock.message.create).toHaveBeenCalledWith({
      data: {
        id: "crm-msg-1",
        conversationId: "conv-1",
        role: "assistant",
        content: happyBody.text,
      },
    });
  });

  it("replay idempotente: mismo clientMessageId → devuelve el existente y NO re-envía", async () => {
    const existing = {
      id: "crm-msg-1",
      conversationId: "conv-1",
      role: "assistant",
      content: happyBody.text,
    };
    prismaMock.message.findUnique.mockResolvedValue(existing);

    const res = await request(app, "POST", "/service/telegram/send", happyBody, authed());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("crm-msg-1");
    expect(tgMock.sendMessage).not.toHaveBeenCalled();
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("404 si la conversación no existe", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(null);

    const res = await request(app, "POST", "/service/telegram/send", happyBody, authed());

    expect(res.status).toBe(404);
    expect(tgMock.sendMessage).not.toHaveBeenCalled();
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("404 si el agente de la conversación no tiene canal Telegram conectado", async () => {
    prismaMock.channelConnection.findUnique.mockResolvedValue(null);

    const res = await request(app, "POST", "/service/telegram/send", happyBody, authed());

    expect(res.status).toBe(404);
    expect(tgMock.sendMessage).not.toHaveBeenCalled();
  });

  it("400 si la conversación no tiene chat de Telegram asociado", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      agentId: "agent-1",
      metadata: {},
    });

    const res = await request(app, "POST", "/service/telegram/send", happyBody, authed());

    expect(res.status).toBe(400);
    expect(tgMock.sendMessage).not.toHaveBeenCalled();
  });

  it("502 (NO fail-soft) si la Bot API rechaza el envío; no persiste el mensaje", async () => {
    tgMock.sendMessage.mockRejectedValue(new Error("chat not found"));

    const res = await request(app, "POST", "/service/telegram/send", happyBody, authed());

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("telegram_send_failed");
    expect(res.body.detail).toBe("chat not found");
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("carrera de replays: create choca con P2002 → devuelve el mensaje ya persistido", async () => {
    // Primer chequeo no lo ve; el create concurrente ya lo insertó.
    prismaMock.message.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "crm-msg-1",
        conversationId: "conv-1",
        role: "assistant",
        content: happyBody.text,
      });
    prismaMock.message.create.mockRejectedValue(
      Object.assign(new Error("unique constraint"), { code: "P2002" })
    );

    const res = await request(app, "POST", "/service/telegram/send", happyBody, authed());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("crm-msg-1");
  });

  it("400 si falta conversationId o text", async () => {
    const res = await request(
      app,
      "POST",
      "/service/telegram/send",
      { businessId: "n1", text: "hola" },
      authed()
    );
    expect(res.status).toBe(400);
    expect(tgMock.sendMessage).not.toHaveBeenCalled();
  });
});
