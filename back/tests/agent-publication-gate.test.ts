/**
 * H3 (aa-agente-ciclo-vida-publicacion) — El gate de publicación en el motor (T2.1/T2.2).
 *
 * H1 dejó el gate de saldo en `chatWithAgent`/`runAgent` porque son el cuello por el que
 * pasan los tres canales (widget, Telegram, WhatsApp). El de publicación va en los mismos
 * dos puntos y SIEMPRE ANTES: un borrador con el cupo agotado tiene que decir "no
 * publicado" — el problema real — y no "sin cupo", que sería una pista falsa.
 *
 * Aquí se usan los dos gates REALES con prisma mockeado; sólo `deductTokens` se espía.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/openai", () => {
  const client = { chat: { completions: { create: vi.fn() } } };
  return {
    openai: client,
    getClientForAgent: vi.fn(() => ({ client, isOpenclaw: false })),
  };
});
vi.mock("@/lib/agent/executor", () => ({ executeTool: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ processNewLead: vi.fn() }));
vi.mock("@/lib/token-metering", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/token-metering")>();
  return { ...actual, deductTokens: vi.fn() };
});
vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUniqueOrThrow: vi.fn() },
    tenant: { findUnique: vi.fn() },
    knowledgeChunk: { count: vi.fn() },
    conversation: { create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    message: { createMany: vi.fn() },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { deductTokens } from "@/lib/token-metering";
import { chatWithAgent } from "@/lib/agent/engine";

const mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;
const mockDeduct = deductTokens as ReturnType<typeof vi.fn>;
const mockAgent = prisma.agent.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockTenant = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const mockCount = prisma.knowledgeChunk.count as ReturnType<typeof vi.fn>;
const mockConvCreate = prisma.conversation.create as ReturnType<typeof vi.fn>;
const mockConvUpdate = prisma.conversation.update as ReturnType<typeof vi.fn>;
const mockMsgCreateMany = prisma.message.createMany as ReturnType<typeof vi.fn>;
const mockLeadFind = prisma.lead.findUnique as ReturnType<typeof vi.fn>;

function baseAgent(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    name: "Bot",
    model: "gpt-4o",
    temperature: 0.5,
    systemPrompt: "Sé útil",
    ecommerceConfig: null,
    integrations: [],
    skills: [],
    tenantId: "tenant-1",
    status: "published",
    ...over,
  };
}

function textCompletion(content: string, tokens = 5) {
  return { usage: { total_tokens: tokens }, choices: [{ message: { content, tool_calls: [] } }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAgent.mockResolvedValue(baseAgent());
  // `credentialMode` (H2): columna NOT NULL con default 'platform' — en la BD real siempre viene.
  mockTenant.mockResolvedValue({
    isActive: true,
    tokenBalance: 1000,
    tokensUsed: 10,
    credentialMode: "platform",
  });
  mockCount.mockResolvedValue(0);
  mockLeadFind.mockResolvedValue(null);
  mockConvUpdate.mockResolvedValue({});
  mockMsgCreateMany.mockResolvedValue({});
  mockConvCreate.mockResolvedValue({
    id: "conv-1",
    agentId: "a1",
    channel: "widget",
    metadata: {},
    messages: [],
  });
});

describe("T2.1 — un agente no publicado no atiende", () => {
  it("draft: 403 sin llamar al LLM, sin crear Conversation y sin descontar", async () => {
    mockAgent.mockResolvedValue(baseAgent({ status: "draft" }));

    await expect(chatWithAgent("a1", "hola", undefined, "widget")).rejects.toMatchObject({
      status: 403,
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockConvCreate).not.toHaveBeenCalled();
    expect(mockDeduct).not.toHaveBeenCalled();
  });

  it("archived: cortado igual, con su motivo propio", async () => {
    mockAgent.mockResolvedValue(baseAgent({ status: "archived" }));

    await expect(chatWithAgent("a1", "hola", undefined, "widget")).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/retirado/i),
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("suspended: 402, para que el widget lo trate como el corte por impago de H1", async () => {
    mockAgent.mockResolvedValue(baseAgent({ status: "suspended" }));

    await expect(chatWithAgent("a1", "hola", undefined, "widget")).rejects.toMatchObject({
      status: 402,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("estado corrupto: fail-closed, no se sirve por defecto", async () => {
    mockAgent.mockResolvedValue(baseAgent({ status: "en_revision" }));

    await expect(chatWithAgent("a1", "hola", undefined, "widget")).rejects.toMatchObject({
      status: 403,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("los canales de mensajería pasan por el mismo cuello (no sólo el widget)", async () => {
    mockAgent.mockResolvedValue(baseAgent({ status: "draft" }));

    await expect(chatWithAgent("a1", "hola", undefined, "telegram")).rejects.toMatchObject({
      status: 403,
    });
    await expect(chatWithAgent("a1", "hola", undefined, "whatsapp")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("published sigue atendiendo y cobrando exactamente como antes del change", async () => {
    mockCreate.mockResolvedValueOnce(textCompletion("Hola", 21));

    const reply = await chatWithAgent("a1", "hola", undefined, "widget");

    expect(reply.text).toBe("Hola");
    expect(mockDeduct).toHaveBeenCalledWith("tenant-1", "a1", "conv-1", 21, "gpt-4o", undefined, "platform");
  });
});

describe("T2.1 — orden de los gates: publicación antes que saldo", () => {
  it("draft + cupo agotado dice 'no publicado' (403), no 'sin cupo' (402)", async () => {
    mockAgent.mockResolvedValue(baseAgent({ status: "draft" }));
    mockTenant.mockResolvedValue({ isActive: true, tokenBalance: 100, tokensUsed: 100 });

    await expect(chatWithAgent("a1", "hola", undefined, "widget")).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/no está publicado/i),
    });
  });

  it("draft sin tenant tampoco se confunde con el 402 de H1", async () => {
    mockAgent.mockResolvedValue(baseAgent({ status: "draft", tenantId: null }));

    await expect(chatWithAgent("a1", "hola", undefined, "widget")).rejects.toMatchObject({
      status: 403,
    });
    // El gate de saldo no llega a consultar el tenant: se cortó antes.
    expect(mockTenant).not.toHaveBeenCalled();
  });

  it("published + tenant sin cupo sigue cortando por saldo (402): H1 intacto", async () => {
    mockTenant.mockResolvedValue({ isActive: true, tokenBalance: 100, tokensUsed: 100 });

    await expect(chatWithAgent("a1", "hola", undefined, "widget")).rejects.toMatchObject({
      status: 402,
    });
  });
});

describe("T2.2 — la consola de pruebas puede hablar con un borrador", () => {
  it("draft + isTest responde: el flujo es crear → probar → publicar", async () => {
    mockAgent.mockResolvedValue(baseAgent({ status: "draft" }));
    mockCreate.mockResolvedValueOnce(textCompletion("Respuesta de prueba", 12));

    const reply = await chatWithAgent("a1", "hola", undefined, "widget", undefined, true);

    expect(reply.text).toBe("Respuesta de prueba");
    // Con tenant asignado el consumo se sigue cargando (regresión H1/AC6): probar no es gratis.
    expect(mockDeduct).toHaveBeenCalledWith("tenant-1", "a1", "conv-1", 12, "gpt-4o", undefined, "platform");
  });

  it("la exención es acotada: isTest NO revive un suspended", async () => {
    // Si eximiera, la consola sería la vía para seguir atendiendo a un tenant que no paga.
    mockAgent.mockResolvedValue(baseAgent({ status: "suspended" }));

    await expect(
      chatWithAgent("a1", "hola", undefined, "widget", undefined, true)
    ).rejects.toMatchObject({ status: 402 });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("la exención es acotada: isTest NO revive un archived", async () => {
    mockAgent.mockResolvedValue(baseAgent({ status: "archived" }));

    await expect(
      chatWithAgent("a1", "hola", undefined, "widget", undefined, true)
    ).rejects.toMatchObject({ status: 403 });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
