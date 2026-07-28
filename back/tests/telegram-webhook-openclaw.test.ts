/**
 * Integración inbound (5.4a aa-centro-mando-agenda-telegram): un mensaje de
 * Telegram que llega al webhook por-agente de AA para un agente
 * runtime="openclaw" atraviesa el pipeline real de chat (chatWithAgent →
 * runAgent → runToolLoop) y usa el cerebro de OpenClaw vía getClientForAgent
 * (cliente OpenAI-compatible mockeado), persiste in/out y responde por la
 * Bot API con el token del propio bot. AA canal + cerebro OpenClaw.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  channelConnection: { findUnique: vi.fn() },
  conversation: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  message: { createMany: vi.fn() },
  lead: { findUnique: vi.fn(), upsert: vi.fn() },
  agent: { findUniqueOrThrow: vi.fn() },
  knowledgeChunk: { count: vi.fn() },
}));

const tgSendMessage = vi.hoisted(() => vi.fn());

// Cliente OpenAI-compatible falso: representa el gateway de OpenClaw.
const openclawCreate = vi.hoisted(() => vi.fn());
const getClientForAgentMock = vi.hoisted(() =>
  vi.fn((agent: { runtime?: string | null; agentId?: string | null }) =>
    agent?.runtime === "openclaw"
      ? {
          client: { chat: { completions: { create: openclawCreate } } },
          model: agent.agentId ? `openclaw/aa-${agent.agentId}` : "openclaw/default",
          isOpenclaw: true,
        }
      : { client: { chat: { completions: { create: openclawCreate } } }, isOpenclaw: false }
  )
);

const webhookSharedMock = vi.hoisted(() => ({
  PUBLIC_URL: () => "https://aa.example.com",
  encryptCreds: vi.fn(),
  decryptCreds: vi.fn(() => ({ token: "bot-token-123" })),
  resolveConversation: vi.fn(async () => "conv-1"),
  mergeConversationMetadata: vi.fn(async () => undefined),
  // El webhook usa esto en su catch. Si falta en el mock, cualquier fallo del pipeline se
  // presenta como "No export is defined" y tapa el error real.
  channelErrorMessage: vi.fn(() => "Lo siento, ha ocurrido un error."),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/channels/webhook-shared", () => webhookSharedMock);
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: openclawCreate } } },
  getClientForAgent: getClientForAgentMock,
}));
vi.mock("@/lib/agent/executor", () => ({ executeTool: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ processNewLead: vi.fn() }));
vi.mock("@/lib/token-metering", () => ({
  deductTokens: vi.fn(),
  // H1 (aa-metering-fail-closed): el gate real corta si el agente no tiene tenant. En
  // tests se deja pasar y se devuelve el tenant del agente, de modo que deductTokens
  // recibe exactamente lo mismo que antes del change (regresión cero).
  // H2: el gate devuelve tenant + modo de credenciales. Los mocks reproducen la forma real
  // ("platform" por defecto) para que el motor resuelva el cliente global, como antes.
  assertUsageAllowed: vi.fn(async (tenantId?: string | null) => ({
    meteredTenantId: tenantId ?? null,
    credentialMode: "platform",
  })),
}));
// sendMessage stub + parseTelegramUpdate/format reales (no hay red en sendMessage stub).
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

let updateSeq = 1000;

function telegramReq(text: string, secret = "hook-secret") {
  return {
    params: { agentId: "agent-1" },
    headers: { "x-telegram-bot-api-secret-token": secret },
    body: {
      update_id: updateSeq++,
      message: { message_id: 1, chat: { id: 555 }, text },
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  tgSendMessage.mockResolvedValue(undefined);
  prismaMock.channelConnection.findUnique.mockResolvedValue({
    credentials: "encrypted",
    webhookSecret: "hook-secret",
  });
  // Conversación existente con leadFlow ya en "assisting" → el mensaje va al
  // agente (runAgent), no al flujo determinista de captación de nombre.
  prismaMock.conversation.findUniqueOrThrow.mockResolvedValue({
    id: "conv-1",
    metadata: { leadFlow: { step: "assisting", customerName: "Ana" } },
    messages: [],
  });
  prismaMock.conversation.update.mockResolvedValue({});
  prismaMock.message.createMany.mockResolvedValue({ count: 2 });
  prismaMock.lead.findUnique.mockResolvedValue(null);
  prismaMock.knowledgeChunk.count.mockResolvedValue(0);
  prismaMock.agent.findUniqueOrThrow.mockResolvedValue({
    id: "agent-1",
    name: "Bot",
    model: "gpt-4o",
    temperature: 0.5,
    systemPrompt: "Sé útil",
    runtime: "openclaw",
    ecommerceConfig: null,
    integrations: [],
    skills: [],
    // H3 (aa-agente-ciclo-vida-publicacion): el gate de publicación es fail-closed, así que
    // un agente de canal sin estado no atiende. Telegram sirve tráfico real: publicado.
    status: "published",
  });
  openclawCreate.mockResolvedValue({
    usage: { total_tokens: 7 },
    choices: [{ message: { content: "Respuesta del cerebro OpenClaw", tool_calls: [] } }],
  });
});

describe("webhook Telegram inbound — agente runtime='openclaw' (AA canal + cerebro OpenClaw)", () => {
  it("persiste in/out, invoca el cerebro OpenClaw vía getClientForAgent y responde por la Bot API", async () => {
    const res = mockRes();

    await handleTelegramWebhook(telegramReq("Quiero información sobre el plan Pro"), res);

    expect(res.body).toEqual({ ok: true });

    // El pipeline de chat resolvió el cliente por runtime del agente…
    expect(getClientForAgentMock).toHaveBeenCalledWith(
      // H2: el resolutor recibe también tenant/modo/modelo. runtime="openclaw" los IGNORA (no
      // hay clave de proveedor cloud que traer), pero llegan por la misma vía.
      expect.objectContaining({ runtime: "openclaw", agentId: "agent-1" })
    );
    // …y llamó al gateway OpenClaw con el target per-agente (no Agent.model).
    expect(openclawCreate).toHaveBeenCalledTimes(1);
    expect(openclawCreate.mock.calls[0][0].model).toBe("openclaw/aa-agent-1");

    // Respuesta enviada por la Bot API con el token del bot del agente (AA único escritor).
    expect(tgSendMessage).toHaveBeenCalledWith("bot-token-123", 555, "Respuesta del cerebro OpenClaw");

    // Persistencia in/out en la conversación.
    expect(prismaMock.message.createMany).toHaveBeenCalledTimes(1);
    const persisted = prismaMock.message.createMany.mock.calls[0][0].data;
    expect(persisted).toEqual([
      expect.objectContaining({ role: "user", content: "Quiero información sobre el plan Pro" }),
      expect.objectContaining({ role: "assistant", content: "Respuesta del cerebro OpenClaw" }),
    ]);
  });

  it("rechaza con 403 un update sin el webhookSecret correcto (los agentes openclaw ahora tienen secret)", async () => {
    const res = mockRes();

    await handleTelegramWebhook(telegramReq("hola", "wrong-secret"), res);

    expect(res.statusCode).toBe(403);
    expect(openclawCreate).not.toHaveBeenCalled();
    expect(tgSendMessage).not.toHaveBeenCalled();
  });
});
