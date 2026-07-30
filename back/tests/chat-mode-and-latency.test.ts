// F1 (aa-agente-consola-pruebas): T1.1 (latencia por turno) + T1.2 (modo test).
// Caracterización de chatWithAgent (engine.ts) mockeando openai/executor/db —
// mismo patrón que tests/engine.test.ts.

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
vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUniqueOrThrow: vi.fn() },
    // aa-reservas-fecha-y-zona-del-modelo: el motor resuelve la zona del negocio para anclar
    // la fecha de hoy en el prompt de sistema.
    agentSchedule: { findUnique: vi.fn(async () => ({ timezone: "Europe/Madrid" })) },
    knowledgeChunk: { count: vi.fn() },
    conversation: {
      create: vi.fn(),
      // La escritura de metadata al cierre del turno hace merge contra la fila FRESCA.
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    message: { createMany: vi.fn() },
    lead: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  },
}));

import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { deductTokens } from "@/lib/token-metering";
import { chatWithAgent } from "@/lib/agent/engine";

const mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;
const mockDeduct = deductTokens as ReturnType<typeof vi.fn>;
const mockAgent = prisma.agent.findUniqueOrThrow as ReturnType<typeof vi.fn>;
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
    // H3 (aa-agente-ciclo-vida-publicacion): el gate de publicación es fail-closed y corre
    // antes que el de saldo, así que un fixture sin estado no llega al motor.
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
  mockCount.mockResolvedValue(0);
  mockLeadFind.mockResolvedValue(null);
  mockConvUpdate.mockResolvedValue({});
  mockMsgCreateMany.mockResolvedValue({});
});

describe("chatWithAgent — T1.1 latencia por turno", () => {
  it("la respuesta incluye latencyMs numérico ≥ 0", async () => {
    mockConvCreate.mockResolvedValue({
      id: "conv-1",
      agentId: "a1",
      channel: "widget",
      metadata: {},
      messages: [],
    });
    mockCreate.mockResolvedValueOnce(textCompletion("Hola humano", 7));

    const reply = await chatWithAgent("a1", "hola", undefined, "widget", "tenant-1");

    expect(typeof reply.latencyMs).toBe("number");
    expect(reply.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("chatWithAgent — T1.2 modo test (regresión cero)", () => {
  it("sin `test`, la Conversation creada queda isTest=false (idéntico a hoy)", async () => {
    mockConvCreate.mockResolvedValue({
      id: "conv-2",
      agentId: "a1",
      channel: "widget",
      metadata: {},
      messages: [],
    });
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await chatWithAgent("a1", "hola", undefined, "widget", "tenant-1");

    expect(mockConvCreate).toHaveBeenCalledWith({
      data: { agentId: "a1", channel: "widget", isTest: false },
      include: { messages: true },
    });
  });

  it("con test:true, la Conversation creada queda isTest=true", async () => {
    mockConvCreate.mockResolvedValue({
      id: "conv-3",
      agentId: "a1",
      channel: "widget",
      metadata: {},
      messages: [],
    });
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await chatWithAgent("a1", "hola", undefined, "widget", "tenant-1", true);

    expect(mockConvCreate).toHaveBeenCalledWith({
      data: { agentId: "a1", channel: "widget", isTest: true },
      include: { messages: true },
    });
  });

  it("AC6/T1.2b: el metering (deductTokens) sigue llamándose en modo test", async () => {
    mockConvCreate.mockResolvedValue({
      id: "conv-4",
      agentId: "a1",
      channel: "widget",
      metadata: {},
      messages: [],
    });
    mockCreate.mockResolvedValueOnce(textCompletion("ok", 42));

    await chatWithAgent("a1", "hola", undefined, "widget", "tenant-1", true);

    expect(mockDeduct).toHaveBeenCalledWith("tenant-1", "a1", "conv-4", 42, "gpt-4o", undefined, "platform", expect.anything());
  });
});

// T8.6 (aa-servicios-completos-y-enlaces-clicables): el cableado del aviso, no sólo la función.
// El respaldo determinista arregla la BD y no arregla la conversación: medido tres veces contra
// producción, el visitante escribe su móvil suelto y el agente contesta "¿podrías aclarar qué
// quieres decir con esos números?". El aviso sólo sirve si llega al modelo en ESTE turno.
describe("chatWithAgent — aviso de contacto del turno", () => {
  it("el móvil suelto llega al modelo como hecho del turno", async () => {
    mockConvCreate.mockResolvedValue({
      id: "conv-aviso",
      agentId: "a1",
      channel: "widget",
      metadata: {},
      messages: [],
    });
    // Lead abierto con el nombre y el email ya dados; falta el teléfono.
    mockLeadFind.mockResolvedValue({ id: "l1", email: "marta@taller.es", phone: null });
    mockCreate.mockResolvedValueOnce(textCompletion("Gracias, apunto tu teléfono"));

    await chatWithAgent("a1", "600 45 12 90", undefined, "widget", "tenant-1");

    const msgs = mockCreate.mock.calls[0][0].messages;
    const aviso = msgs[msgs.length - 2];
    expect(aviso.role).toBe("system");
    expect(aviso.content).toContain("600451290");
    expect(msgs[msgs.length - 1]).toMatchObject({ role: "user", content: "600 45 12 90" });
  });

  it("un turno normal no lleva aviso alguno", async () => {
    mockConvCreate.mockResolvedValue({
      id: "conv-aviso-2",
      agentId: "a1",
      channel: "widget",
      metadata: {},
      messages: [],
    });
    mockLeadFind.mockResolvedValue(null);
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await chatWithAgent("a1", "¿cuánto cuesta una landing?", undefined, "widget", "tenant-1");

    const msgs = mockCreate.mock.calls[0][0].messages;
    expect(msgs.filter((m: { role: string }) => m.role === "system")).toHaveLength(1);
  });
});
