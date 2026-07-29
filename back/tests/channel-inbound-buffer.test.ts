/**
 * aa-canales-buffer-y-respuesta-partida — T2 (enganche del ritmo en los webhooks).
 *
 * GWT1: con `inboundBufferMs > 0`, tres mensajes seguidos del mismo cliente →
 *   UNA sola llamada a `chatWithAgent` con los textos unidos por "\n" y UNA
 *   respuesta.
 * GWT2: con `inboundBufferMs = 0` (default) el webhook de WhatsApp responde en la
 *   misma petición, sin temporizador — exactamente como antes del change.
 * GWT7: un reintento del proveedor con el mismo id no vuelve a añadir el texto.
 *
 * Se usan temporizadores reales con ventanas de pocas decenas de ms: el flush
 * encadena varios `await` sobre promesas mockeadas y con fake timers habría que
 * bombear microtareas a mano en cada paso, que es donde estos tests se vuelven
 * frágiles sin comprobar nada más.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";

const prismaMock = vi.hoisted(() => ({
  channelConnection: { findUnique: vi.fn() },
  agent: { findUnique: vi.fn() },
}));

const tgSendMessage = vi.hoisted(() => vi.fn());
const waSendMessage = vi.hoisted(() => vi.fn());
const chatWithAgentMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));
vi.mock("@/lib/agent/engine", () => ({ chatWithAgent: chatWithAgentMock }));
vi.mock("@/lib/channels/crm-telegram-fanout", () => ({ fanOutTelegramToCrm: vi.fn() }));
vi.mock("@/lib/channels/webhook-shared", () => ({
  decryptCreds: vi.fn(() => ({
    token: "bot-token-123",
    phoneNumberId: "pn-1",
    accessToken: "wa-token",
    verifyToken: "verify",
  })),
  resolveConversation: vi.fn(async () => "conv-1"),
  mergeConversationMetadata: vi.fn(async () => undefined),
  channelErrorMessage: vi.fn(() => "Lo siento, ha ocurrido un error."),
}));
vi.mock("@/lib/channels/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/channels/telegram")>();
  return { ...actual, sendMessage: tgSendMessage };
});
vi.mock("@/lib/channels/whatsapp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/channels/whatsapp")>();
  return { ...actual, sendMessage: waSendMessage };
});

import { handleTelegramWebhook } from "@/lib/channels/telegram-webhook";
import { handleWhatsAppWebhook } from "@/lib/channels/whatsapp-webhook";
import { resetInboundBuffers, pendingInboundCount } from "@/lib/channels/inbound-buffer";

const APP_SECRET = "meta-app-secret-test";

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

let updateSeq = 9000;
function telegramReq(text: string, chatId = 777, updateId?: number) {
  return {
    params: { agentId: "agent-1" },
    headers: { "x-telegram-bot-api-secret-token": "hook-secret" },
    body: {
      update_id: updateId ?? updateSeq++,
      message: { message_id: 1, chat: { id: chatId }, text },
    },
  } as any;
}

let waSeq = 100;
function whatsappReq(text: string, from = "34600111222", messageId?: string) {
  const body = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: messageId ?? `wamid-${waSeq++}`,
                  from,
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature =
    "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
  return {
    params: { agentId: "agent-1" },
    headers: { "x-hub-signature-256": signature },
    rawBody,
    body,
  } as any;
}

/** Ritmo devuelto por prisma para el agente bajo prueba. */
function setPacing(pacing: {
  inboundBufferMs?: number;
  replyMaxMessages?: number;
  replySplitPauseMs?: number;
}) {
  prismaMock.agent.findUnique.mockResolvedValue({
    tenantId: "tenant-1",
    inboundBufferMs: pacing.inboundBufferMs ?? 0,
    replyMaxMessages: pacing.replyMaxMessages ?? 1,
    replySplitPauseMs: pacing.replySplitPauseMs ?? 0,
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  vi.clearAllMocks();
  resetInboundBuffers();
  process.env.META_APP_SECRET = APP_SECRET;
  tgSendMessage.mockResolvedValue(undefined);
  waSendMessage.mockResolvedValue(undefined);
  chatWithAgentMock.mockResolvedValue({ conversationId: "conv-1", text: "respuesta LLM" });
  prismaMock.channelConnection.findUnique.mockResolvedValue({
    credentials: "encrypted",
    webhookSecret: "hook-secret",
  });
  setPacing({});
});

afterEach(() => {
  resetInboundBuffers();
});

describe("GWT1 — agrupación de entrantes", () => {
  it("tres mensajes seguidos → UNA llamada al LLM con los textos unidos y UNA respuesta", async () => {
    setPacing({ inboundBufferMs: 60 });

    for (const text of ["hola", "oye", "¿abrís hoy?"]) {
      const res = mockRes();
      await handleTelegramWebhook(telegramReq(text), res);
      // El webhook contesta ya: el turno ocurre después.
      expect(res.body).toEqual({ ok: true });
    }

    expect(chatWithAgentMock).not.toHaveBeenCalled();
    expect(pendingInboundCount()).toBe(1);

    await wait(150);

    expect(chatWithAgentMock).toHaveBeenCalledTimes(1);
    expect(chatWithAgentMock.mock.calls[0][1]).toBe("hola\noye\n¿abrís hoy?");
    expect(tgSendMessage).toHaveBeenCalledTimes(1);
    expect(tgSendMessage.mock.calls[0][2]).toBe("respuesta LLM");
  });

  it("dos clientes distintos no se mezclan (AC6 en el webhook)", async () => {
    setPacing({ inboundBufferMs: 60 });

    await handleTelegramWebhook(telegramReq("soy A", 111), mockRes());
    await handleTelegramWebhook(telegramReq("soy B", 222), mockRes());
    expect(pendingInboundCount()).toBe(2);

    await wait(150);

    expect(chatWithAgentMock).toHaveBeenCalledTimes(2);
    const enviados = chatWithAgentMock.mock.calls.map((c) => c[1]).sort();
    expect(enviados).toEqual(["soy A", "soy B"]);
  });
});

describe("GWT2 — default intacto", () => {
  it("WhatsApp con inboundBufferMs = 0 responde en la misma petición, sin buffer", async () => {
    const res = mockRes();

    await handleWhatsAppWebhook(whatsappReq("quiero cita"), res);

    // Ya respondido cuando el webhook devuelve: nada aplazado.
    expect(chatWithAgentMock).toHaveBeenCalledTimes(1);
    expect(chatWithAgentMock).toHaveBeenCalledWith(
      "agent-1",
      "quiero cita",
      "conv-1",
      "whatsapp"
    );
    expect(waSendMessage).toHaveBeenCalledTimes(1);
    expect(waSendMessage.mock.calls[0][3]).toBe("respuesta LLM");
    expect(pendingInboundCount()).toBe(0);
    expect(res.body).toEqual({ ok: true });
  });

  it("Telegram con inboundBufferMs = 0 responde en la misma petición", async () => {
    const res = mockRes();

    await handleTelegramWebhook(telegramReq("hola"), res);

    expect(chatWithAgentMock).toHaveBeenCalledTimes(1);
    expect(tgSendMessage).toHaveBeenCalledTimes(1);
    expect(pendingInboundCount()).toBe(0);
  });

  it("respuesta partida: replyMaxMessages = 2 → dos envíos con el contenido íntegro", async () => {
    setPacing({ replyMaxMessages: 2 });
    chatWithAgentMock.mockResolvedValue({
      conversationId: "conv-1",
      text: "Hola. Abrimos de 9 a 14.",
    });
    const res = mockRes();

    await handleTelegramWebhook(telegramReq("¿horario?"), res);

    expect(tgSendMessage).toHaveBeenCalledTimes(2);
    expect(tgSendMessage.mock.calls[0][2]).toBe("Hola.");
    expect(tgSendMessage.mock.calls[1][2]).toBe("Abrimos de 9 a 14.");
  });
});

describe("GWT7 — reintento del proveedor", () => {
  it("mismo messageId de WhatsApp reintentado → no se añade dos veces y responde 200", async () => {
    setPacing({ inboundBufferMs: 60 });

    const res1 = mockRes();
    await handleWhatsAppWebhook(whatsappReq("hola", "34600111222", "wamid-fijo"), res1);
    const res2 = mockRes();
    await handleWhatsAppWebhook(whatsappReq("hola", "34600111222", "wamid-fijo"), res2);

    expect(res1.body).toEqual({ ok: true });
    expect(res2.body).toEqual({ ok: true });
    expect(pendingInboundCount()).toBe(1);

    await wait(150);

    expect(chatWithAgentMock).toHaveBeenCalledTimes(1);
    expect(chatWithAgentMock.mock.calls[0][1]).toBe("hola");
  });

  it("mismo update_id de Telegram reintentado → un solo turno", async () => {
    setPacing({ inboundBufferMs: 60 });

    await handleTelegramWebhook(telegramReq("oye", 333, 9999), mockRes());
    await handleTelegramWebhook(telegramReq("oye", 333, 9999), mockRes());

    await wait(150);

    expect(chatWithAgentMock).toHaveBeenCalledTimes(1);
    expect(chatWithAgentMock.mock.calls[0][1]).toBe("oye");
  });
});
