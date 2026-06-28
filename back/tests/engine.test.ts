// Tests de caracterización de runAgent (engine.ts).
// Fijan el comportamiento del loop agéntico ANTES de refactorizar el módulo:
// construcción de tools/system prompt, ejecución de tool-calls, manejo de errores,
// tope de iteraciones y metering de tokens. Mockean openai, executor, prisma.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("@/lib/agent/executor", () => ({ executeTool: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ processNewLead: vi.fn() }));
vi.mock("@/lib/token-metering", () => ({ deductTokens: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUniqueOrThrow: vi.fn() },
    knowledgeChunk: { count: vi.fn() },
  },
}));

import { openai } from "@/lib/openai";
import { executeTool } from "@/lib/agent/executor";
import { prisma } from "@/lib/db";
import { runAgent, buildAgentTools, buildSystemPrompt } from "@/lib/agent/engine";

const mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;
const mockExec = executeTool as ReturnType<typeof vi.fn>;
const mockAgent = prisma.agent.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockCount = prisma.knowledgeChunk.count as ReturnType<typeof vi.fn>;

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
    ...over,
  };
}

function textCompletion(content: string, tokens = 5) {
  return { usage: { total_tokens: tokens }, choices: [{ message: { content, tool_calls: [] } }] };
}

function toolCompletion(name: string, args: string, tokens = 10, id = "c1") {
  return {
    usage: { total_tokens: tokens },
    choices: [{ message: { content: null, tool_calls: [{ id, type: "function", function: { name, arguments: args } }] } }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAgent.mockResolvedValue(baseAgent());
  mockCount.mockResolvedValue(0);
});

describe("runAgent — respuesta directa (sin tools)", () => {
  it("devuelve texto, sin toolCalls, con model y tokensUsed", async () => {
    mockCreate.mockResolvedValueOnce(textCompletion("Hola humano", 7));

    const reply = await runAgent("a1", "hola");

    expect(reply.text).toBe("Hola humano");
    expect(reply.toolCalls).toEqual([]);
    expect(reply.tokensUsed).toBe(7);
    expect(reply.model).toBe("gpt-4o");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("system prompt incluye el nombre del agente; tools incluyen intención y handoff", async () => {
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await runAgent("a1", "hola");

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toContain("Bot");
    const toolNames = call.tools.map((t: any) => t.function.name);
    expect(toolNames).toContain("record_lead_intent");
    expect(toolNames).toContain("request_human_handoff");
  });

  it("incluye el historial y el mensaje de usuario en orden", async () => {
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await runAgent("a1", "tercero", [
      { role: "user", content: "primero" },
      { role: "assistant", content: "segundo" },
    ]);

    const msgs = mockCreate.mock.calls[0][0].messages;
    expect(msgs[1]).toMatchObject({ role: "user", content: "primero" });
    expect(msgs[2]).toMatchObject({ role: "assistant", content: "segundo" });
    expect(msgs[3]).toMatchObject({ role: "user", content: "tercero" });
  });
});

describe("runAgent — bloque de conocimiento (RAG)", () => {
  it("añade la guía de search_knowledge SOLO si hay chunks", async () => {
    mockCount.mockResolvedValueOnce(0);
    mockCreate.mockResolvedValueOnce(textCompletion("a"));
    await runAgent("a1", "x");
    expect(mockCreate.mock.calls[0][0].messages[0].content).not.toContain("Recomendación basada en conocimiento");

    vi.clearAllMocks();
    mockAgent.mockResolvedValue(baseAgent());
    mockCount.mockResolvedValueOnce(3);
    mockCreate.mockResolvedValueOnce(textCompletion("b"));
    await runAgent("a1", "x");
    expect(mockCreate.mock.calls[0][0].messages[0].content).toContain("Recomendación basada en conocimiento");
  });
});

describe("runAgent — ejecución de tool-calls", () => {
  it("ejecuta la tool, registra el resultado y suma tokens de ambas iteraciones", async () => {
    mockCreate
      .mockResolvedValueOnce(toolCompletion("record_lead_intent", '{"intent":"plan Pro"}', 10))
      .mockResolvedValueOnce(textCompletion("Apuntado", 5));
    mockExec.mockResolvedValueOnce({ ok: true });

    const reply = await runAgent("a1", "quiero el plan Pro", [], undefined, "conv-1");

    expect(mockExec).toHaveBeenCalledWith("a1", "record_lead_intent", { intent: "plan Pro" }, "conv-1");
    expect(reply.toolCalls).toHaveLength(1);
    expect(reply.toolCalls[0]).toMatchObject({ tool: "record_lead_intent", output: { ok: true } });
    expect(reply.text).toBe("Apuntado");
    expect(reply.tokensUsed).toBe(15);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("captura el error de una tool y continúa el loop", async () => {
    mockCreate
      .mockResolvedValueOnce(toolCompletion("record_lead_intent", "{}", 4))
      .mockResolvedValueOnce(textCompletion("seguimos", 2));
    mockExec.mockRejectedValueOnce(new Error("boom"));

    const reply = await runAgent("a1", "x");

    expect(reply.toolCalls[0].error).toBe("boom");
    expect(reply.toolCalls[0].output).toEqual({ error: "boom" });
    expect(reply.text).toBe("seguimos");
  });
});

describe("runAgent — tope de iteraciones", () => {
  it("devuelve mensaje de límite si nunca deja de pedir tools", async () => {
    mockCreate.mockResolvedValue(toolCompletion("record_lead_intent", "{}", 1));
    mockExec.mockResolvedValue({ ok: true });

    const reply = await runAgent("a1", "bucle");

    expect(reply.text).toContain("límite de pasos");
    expect(mockCreate).toHaveBeenCalledTimes(8); // MAX_ITERATIONS
    expect(reply.tokensUsed).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Unit tests directos de los helpers puros extraídos (Ruflo: cubrir ramas).
// ---------------------------------------------------------------------------

function makeCaps(over: Record<string, unknown> = {}) {
  return { executableProviders: [], missingConnections: [], informationalSkills: [], ...over } as any;
}

describe("buildAgentTools", () => {
  it("incluye siempre record_lead_intent y request_human_handoff", () => {
    const names = buildAgentTools([], [], null).map((t) => t.function.name);
    expect(names).toContain("record_lead_intent");
    expect(names).toContain("request_human_handoff");
  });

  it("NO incluye tools de ecommerce sin orderStatusUrl", () => {
    const names = buildAgentTools([], [], null).map((t) => t.function.name);
    expect(names).not.toContain("get_order_status");
  });

  it("incluye tools de ecommerce si hay orderStatusUrl", () => {
    const names = buildAgentTools([], [], { orderStatusUrl: "https://x" } as any).map((t) => t.function.name);
    expect(names).toContain("get_order_status");
  });

  it("no produce nombres duplicados", () => {
    const names = buildAgentTools([], [], { orderStatusUrl: "https://x" } as any).map((t) => t.function.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("buildSystemPrompt", () => {
  const agent = { name: "Bot", systemPrompt: "Sé útil", skills: [] };

  it("base: nombre, líneas fijas siempre; sin RAG/booking/order-status", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], false, null);
    expect(s).toContain('Te llamas "Bot"');
    expect(s).toContain("Usa search_knowledge antes de responder"); // línea fija SIEMPRE
    expect(s).toContain("record_lead_intent"); // intención siempre
    expect(s).toContain("request_human_handoff"); // handoff siempre
    expect(s).not.toContain("Recomendación basada en conocimiento"); // RAG off
    expect(s).not.toContain("Reserva de citas"); // booking off
    expect(s).not.toContain("Estado de pedidos"); // order-status off
  });

  it("incluye la línea fija de search_knowledge incluso con hasKnowledge=false", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], false, null);
    expect(s).toContain("Usa search_knowledge antes de responder preguntas sobre el negocio");
  });

  it("añade bloque RAG si hasKnowledge", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], true, null);
    expect(s).toContain("Recomendación basada en conocimiento");
  });

  it("añade guía de booking si calendar es ejecutable", () => {
    const s = buildSystemPrompt(agent, makeCaps({ executableProviders: ["calendar"] }), [], false, null);
    expect(s).toContain("Reserva de citas");
  });

  it("añade bloque de estado de pedidos si orderStatusUrl", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], false, { orderStatusUrl: "https://x" } as any);
    expect(s).toContain("Estado de pedidos");
  });

  it("añade datos de contacto conocidos si contextFacts", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], false, null, "email: a@b.c");
    expect(s).toContain("Datos del contacto ya conocidos: email: a@b.c");
  });

  it("lista capacidades pendientes e informativas según caps", () => {
    const agentWithSkill = { name: "Bot", systemPrompt: "x", skills: [{ skillId: "s1", skill: { name: "Info", description: "desc" } }] };
    const caps = makeCaps({
      missingConnections: [{ name: "Reservas", physical: "calendar" }],
      informationalSkills: [{ skillId: "s1" }],
    });
    const s = buildSystemPrompt(agentWithSkill, caps, [{ id: "s1", name: "Info", use: "" }], false, null);
    expect(s).toContain("Capacidades que requieren conexión pendiente");
    expect(s).toContain("Reservas");
    expect(s).toContain("Skills informativas");
    expect(s).toContain("Info");
  });
});
