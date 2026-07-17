/**
 * aa-telegram-chatid-autocaptura — F3 (webhook /start <token>).
 *
 * T3.1: token válido → bindea telegramChatId + BORRA telegramPairing + NO llama
 *   chatWithAgent. Token inválido/expirado → mensaje neutro, no bindea. Token
 *   reusado (ya borrado) → no bindea (single-use). Mensaje normal → sí
 *   chatWithAgent (regresión cero).
 * T3.1 security: comparación de tiempo constante; el token nunca aparece en logs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  channelConnection: { findUnique: vi.fn() },
  agentDataBackend: { findUnique: vi.fn(), update: vi.fn() },
  agent: { findUnique: vi.fn() },
}));

const tgSendMessage = vi.hoisted(() => vi.fn());
const chatWithAgentMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));
vi.mock("@/lib/agent/engine", () => ({ chatWithAgent: chatWithAgentMock }));
vi.mock("@/lib/channels/crm-telegram-fanout", () => ({ fanOutTelegramToCrm: vi.fn() }));
vi.mock("@/lib/channels/webhook-shared", () => ({
  decryptCreds: vi.fn(() => ({ token: "bot-token-123" })),
  resolveConversation: vi.fn(async () => "conv-1"),
  mergeConversationMetadata: vi.fn(async () => undefined),
}));
// sendMessage stub; parseTelegramUpdate real.
vi.mock("@/lib/channels/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/channels/telegram")>();
  return { ...actual, sendMessage: tgSendMessage };
});

import { handleTelegramWebhook } from "@/lib/channels/telegram-webhook";

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.json = vi.fn((b: any) => {
    res.body = b;
    return res;
  });
  return res;
}

let updateSeq = 5000;
function telegramReq(text: string, secret = "hook-secret") {
  return {
    params: { agentId: "agent-1" },
    headers: { "x-telegram-bot-api-secret-token": secret },
    body: { update_id: updateSeq++, message: { message_id: 1, chat: { id: 777 }, text } },
  } as any;
}

const FUTURE = new Date(Date.now() + 5 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  tgSendMessage.mockResolvedValue(undefined);
  chatWithAgentMock.mockResolvedValue({ conversationId: "conv-1", text: "respuesta LLM" });
  prismaMock.channelConnection.findUnique.mockResolvedValue({
    credentials: "encrypted",
    webhookSecret: "hook-secret",
  });
  prismaMock.agentDataBackend.update.mockImplementation(async ({ data }: any) => ({
    notificationConfig: data.notificationConfig,
  }));
  prismaMock.agent.findUnique.mockResolvedValue({ tenantId: "tenant-1" });
});

describe("F3 — webhook /start <token>", () => {
  it("token válido → bindea telegramChatId, BORRA telegramPairing y NO llama chatWithAgent", async () => {
    prismaMock.agentDataBackend.findUnique.mockResolvedValue({
      notificationConfig: {
        events: ["nuevo_lead"],
        telegramPairing: { token: "VALID-TOKEN-abc", expiresAt: FUTURE },
      },
    });
    const res = mockRes();

    await handleTelegramWebhook(telegramReq("/start VALID-TOKEN-abc"), res);

    expect(res.body).toEqual({ ok: true });
    expect(chatWithAgentMock).not.toHaveBeenCalled();

    // Bindeo atómico: fija chatId (string) y borra el pairing (single-use).
    const written = prismaMock.agentDataBackend.update.mock.calls[0][0].data.notificationConfig;
    expect(written.telegramChatId).toBe("777");
    expect(written.events).toEqual(["nuevo_lead"]);
    expect(written.telegramPairing).toBeUndefined();

    expect(tgSendMessage).toHaveBeenCalledWith(
      "bot-token-123",
      777,
      "✅ Listo. Aquí recibirás las notificaciones del negocio."
    );
  });

  it("token inválido → mensaje neutro, NO bindea, NO chatWithAgent", async () => {
    prismaMock.agentDataBackend.findUnique.mockResolvedValue({
      notificationConfig: { telegramPairing: { token: "REAL-TOKEN", expiresAt: FUTURE } },
    });
    const res = mockRes();

    await handleTelegramWebhook(telegramReq("/start WRONG-TOKEN"), res);

    expect(prismaMock.agentDataBackend.update).not.toHaveBeenCalled();
    expect(chatWithAgentMock).not.toHaveBeenCalled();
    expect(tgSendMessage).toHaveBeenCalledWith(
      "bot-token-123",
      777,
      "Este enlace de vinculación no es válido o expiró."
    );
  });

  it("token expirado → NO bindea", async () => {
    prismaMock.agentDataBackend.findUnique.mockResolvedValue({
      notificationConfig: { telegramPairing: { token: "EXPIRED-TOKEN", expiresAt: PAST } },
    });
    const res = mockRes();

    await handleTelegramWebhook(telegramReq("/start EXPIRED-TOKEN"), res);

    expect(prismaMock.agentDataBackend.update).not.toHaveBeenCalled();
    expect(tgSendMessage).toHaveBeenCalledWith(
      "bot-token-123",
      777,
      "Este enlace de vinculación no es válido o expiró."
    );
  });

  it("token reusado (ya borrado, single-use) → NO bindea", async () => {
    // El pairing ya no existe: simula el segundo Start con el mismo token.
    prismaMock.agentDataBackend.findUnique.mockResolvedValue({
      notificationConfig: { telegramChatId: "777" },
    });
    const res = mockRes();

    await handleTelegramWebhook(telegramReq("/start VALID-TOKEN-abc"), res);

    expect(prismaMock.agentDataBackend.update).not.toHaveBeenCalled();
    expect(tgSendMessage).toHaveBeenCalledWith(
      "bot-token-123",
      777,
      "Este enlace de vinculación no es válido o expiró."
    );
  });

  it("mensaje normal (sin /start) → sí llama chatWithAgent (regresión cero)", async () => {
    const res = mockRes();

    await handleTelegramWebhook(telegramReq("Hola, quiero una cita"), res);

    expect(chatWithAgentMock).toHaveBeenCalledTimes(1);
    expect(chatWithAgentMock).toHaveBeenCalledWith(
      "agent-1",
      "Hola, quiero una cita",
      "conv-1",
      "telegram"
    );
    // No se tocó el pairing en el flujo normal.
    expect(prismaMock.agentDataBackend.findUnique).not.toHaveBeenCalled();
  });

  it("'/start' pelado (sin token) → flujo actual (chatWithAgent), no intercepta", async () => {
    const res = mockRes();

    await handleTelegramWebhook(telegramReq("/start"), res);

    expect(chatWithAgentMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.agentDataBackend.update).not.toHaveBeenCalled();
  });

  it("security: el token NUNCA aparece en los logs", async () => {
    prismaMock.agentDataBackend.findUnique.mockResolvedValue({
      notificationConfig: { telegramPairing: { token: "SENSITIVE-TOKEN-xyz", expiresAt: FUTURE } },
    });
    const res = mockRes();

    await handleTelegramWebhook(telegramReq("/start SENSITIVE-TOKEN-xyz"), res);

    const allLogArgs = [
      ...loggerMock.info.mock.calls,
      ...loggerMock.warn.mock.calls,
      ...loggerMock.error.mock.calls,
      ...loggerMock.debug.mock.calls,
    ]
      .flat()
      .map((a) => JSON.stringify(a));
    for (const entry of allLogArgs) {
      expect(entry).not.toContain("SENSITIVE-TOKEN-xyz");
    }
  });
});
