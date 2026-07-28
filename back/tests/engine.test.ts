// Tests de caracterización de runAgent (engine.ts).
// Fijan el comportamiento del loop agéntico ANTES de refactorizar el módulo:
// construcción de tools/system prompt, ejecución de tool-calls, manejo de errores,
// tope de iteraciones y metering de tokens. Mockean openai, executor, prisma.

import { describe, it, expect, vi, beforeEach } from "vitest";

// F1 (aa-openclaw-brain): getClientForAgent es el único punto de entrada al
// cliente OpenAI-compatible en engine.ts. El mock devuelve SIEMPRE el mismo
// spy de chat.completions.create (un solo `mockCreate` sirve para ambos
// runtimes) pero replica la rama real: runtime="openclaw" → model derivado
// per-agente "openclaw/aa-<agentId>" (mismo formato que
// lib/openclaw/agent-id.ts, cierre del gap F1↔F2 03/07/2026) + isOpenclaw=true;
// cualquier otro valor (incluida la ausencia de runtime, filas sin migrar) →
// comportamiento de siempre, sin cambios. La precedencia real de
// OPENCLAW_AGENT_ID (override global) vs. el target per-agente está cubierta
// SIN mocks en tests/openai-agent-client.test.ts — aquí solo se verifica que
// engine.ts reenvía `runtime` + `agentId` correctamente y usa el `model` que
// la factory devuelva.
vi.mock("@/lib/openai", () => {
  const client = { chat: { completions: { create: vi.fn() } } };
  return {
    openai: client,
    getClientForAgent: vi.fn((agent: { runtime?: string | null; agentId?: string | null }) =>
      agent?.runtime === "openclaw"
        ? { client, model: agent.agentId ? `openclaw/aa-${agent.agentId}` : "openclaw/default", isOpenclaw: true }
        : { client, isOpenclaw: false }
    ),
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
    knowledgeChunk: { count: vi.fn() },
  },
}));
// T1.1 (aa-agentes-economia-tokens): el motor ahora recupera conocimiento ANTES del bucle, así
// que necesita su propio mock. Por defecto no devuelve nada: cualquier test que no hable de RAG
// se comporta exactamente como antes del change.
vi.mock("@/lib/embeddings", () => ({ searchKnowledge: vi.fn(async () => []) }));

import { openai, getClientForAgent } from "@/lib/openai";
import { executeTool } from "@/lib/agent/executor";
import { prisma } from "@/lib/db";
import { searchKnowledge } from "@/lib/embeddings";
import {
  runAgent,
  buildAgentTools,
  buildSystemPrompt,
  shouldPrefetchKnowledge,
  buildKnowledgeBlock,
} from "@/lib/agent/engine";

const mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;
const mockGetClient = getClientForAgent as ReturnType<typeof vi.fn>;
const mockExec = executeTool as ReturnType<typeof vi.fn>;
const mockAgent = prisma.agent.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockCount = prisma.knowledgeChunk.count as ReturnType<typeof vi.fn>;
const mockSearch = searchKnowledge as unknown as ReturnType<typeof vi.fn>;

function baseAgent(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    name: "Bot",
    model: "gpt-4o",
    temperature: 0.5,
    systemPrompt: "Sé útil",
    // H3 (aa-agente-ciclo-vida-publicacion): el gate de publicación es fail-closed, así que
    // un fixture sin estado NO atiende. Deliberado: cualquier fixture nuevo que olvide el
    // estado falla en vez de colarse.
    status: "published",
    // H2 (aa-credenciales-byok-multiproveedor): un agente servible pertenece a un tenant (H1
    // ya lo exigía). El resolutor de cliente LLM lo recibe junto al modo de credenciales.
    tenantId: "t1",
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
  mockSearch.mockResolvedValue([]);
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

  // T1.1 (aa-agente-consola-pruebas F1): wall-time del turno, aditivo.
  it("incluye latencyMs numérico ≥ 0 (T1.1, aditivo)", async () => {
    mockCreate.mockResolvedValueOnce(textCompletion("Hola humano", 7));

    const reply = await runAgent("a1", "hola");

    expect(typeof reply.latencyMs).toBe("number");
    expect(reply.latencyMs as number).toBeGreaterThanOrEqual(0);
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

// T1 (aa-agentes-economia-tokens): la recuperación de conocimiento pasa a hacerse ANTES del
// bucle. Antes, cualquier pregunta real gastaba dos iteraciones del bucle (la primera solo para
// que el modelo pidiera search_knowledge), y cada iteración reenvía el prompt completo.
describe("runAgent — recuperación anticipada de conocimiento (T1)", () => {
  // E1
  it("resuelve una pregunta con conocimiento en UNA sola llamada al LLM", async () => {
    mockCount.mockResolvedValueOnce(3);
    mockSearch.mockResolvedValueOnce([{ source: "https://x.es/precios", content: "Corte 20 €" }]);
    mockCreate.mockResolvedValueOnce(textCompletion("Cuesta 20 €"));

    await runAgent("a1", "¿cuánto cuesta un corte de pelo?");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith("a1", "¿cuánto cuesta un corte de pelo?");
  });

  // E1: posición. Los fragmentos NO pueden ir en el bloque de sistema (contenido variable por
  // mensaje ⇒ invalidaría el prefijo cacheado del proveedor), sino entre historial y usuario.
  it("inyecta los fragmentos después del historial y antes del mensaje del usuario", async () => {
    mockCount.mockResolvedValueOnce(3);
    mockSearch.mockResolvedValueOnce([{ source: "https://x.es/precios", content: "Corte 20 €" }]);
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await runAgent("a1", "¿cuánto cuesta el corte?", [
      { role: "user", content: "primero" },
      { role: "assistant", content: "segundo" },
    ]);

    const msgs = mockCreate.mock.calls[0][0].messages;
    expect(msgs).toHaveLength(5);
    expect(msgs[1]).toMatchObject({ role: "user", content: "primero" });
    expect(msgs[2]).toMatchObject({ role: "assistant", content: "segundo" });
    expect(msgs[3].role).toBe("system");
    expect(msgs[3].content).toContain("Corte 20 €");
    expect(msgs[3].content).toContain("https://x.es/precios");
    expect(msgs[4]).toMatchObject({ role: "user", content: "¿cuánto cuesta el corte?" });
    // El bloque de sistema no se contamina con el contenido del turno.
    expect(msgs[0].content).not.toContain("Corte 20 €");
  });

  // E2: la herramienta NO se retira; sigue disponible para búsquedas de seguimiento.
  it("mantiene search_knowledge entre las herramientas", async () => {
    mockCount.mockResolvedValueOnce(3);
    mockSearch.mockResolvedValueOnce([{ source: "s", content: "c" }]);
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await runAgent("a1", "¿tenéis cita el jueves?");

    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: any) => t.function.name);
    expect(toolNames).toContain("search_knowledge");
  });

  // E2: y el prompt deja de ordenar la búsqueda cuando ya viene hecha.
  it("con conocimiento no ordena 'Usa search_knowledge antes de responder'", async () => {
    mockCount.mockResolvedValueOnce(3);
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await runAgent("a1", "¿cuánto cuesta el corte?");

    expect(mockCreate.mock.calls[0][0].messages[0].content).not.toContain(
      "Usa search_knowledge antes de responder"
    );
  });

  // E3: un saludo no gasta embedding ni infla el prompt.
  it("no busca en mensajes cortos sin pregunta", async () => {
    mockCount.mockResolvedValueOnce(3);
    mockCreate.mockResolvedValueOnce(textCompletion("¡Hola!"));

    await runAgent("a1", "Hola");

    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockCreate.mock.calls[0][0].messages).toHaveLength(2);
  });

  it("no busca si el agente no tiene conocimiento indexado", async () => {
    mockCount.mockResolvedValueOnce(0);
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await runAgent("a1", "¿cuánto cuesta el corte de pelo?");

    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("sin fragmentos relevantes no añade mensaje alguno", async () => {
    mockCount.mockResolvedValueOnce(3);
    mockSearch.mockResolvedValueOnce([]);
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await runAgent("a1", "¿cuánto cuesta el corte?");

    expect(mockCreate.mock.calls[0][0].messages).toHaveLength(2);
  });

  // Un fallo de embedding o de pgvector no puede tumbar el turno: la herramienta sigue ahí.
  it("si la búsqueda falla, responde igual sin fragmentos", async () => {
    mockCount.mockResolvedValueOnce(3);
    mockSearch.mockRejectedValueOnce(new Error("pgvector caído"));
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    const reply = await runAgent("a1", "¿cuánto cuesta el corte?");

    expect(reply.text).toBe("ok");
    expect(mockCreate.mock.calls[0][0].messages).toHaveLength(2);
  });
});

// T8 (aa-agentes-economia-tokens): hallazgos del smoke en producción.
describe("runAgent — search_knowledge no se ofrece sin conocimiento (T8.1)", () => {
  // E13. Lo medido en prod: un agente con CERO fragmentos gastaba `iterations: 2` en cada
  // mensaje porque se le ofrecía la herramienta, la llamaba, y la búsqueda devolvía `[]` por
  // definición. Esa segunda vuelta reenvía el prompt entero: ~la mitad del coste del mensaje.
  it("con 0 fragmentos NO manda search_knowledge en las tools", async () => {
    mockCount.mockResolvedValueOnce(0);
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await runAgent("a1", "¿qué servicios ofrecéis?");

    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: any) => t.function.name);
    expect(toolNames).not.toContain("search_knowledge");
  });

  it("con ≥1 fragmento SÍ la manda (no se rompe el caso con conocimiento)", async () => {
    mockCount.mockResolvedValueOnce(3);
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await runAgent("a1", "¿qué servicios ofrecéis?");

    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: any) => t.function.name);
    expect(toolNames).toContain("search_knowledge");
  });

  it("retirar la tool no toca las demás", async () => {
    mockCount.mockResolvedValueOnce(0);
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await runAgent("a1", "hola qué tal");

    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: any) => t.function.name);
    expect(toolNames).toContain("record_lead_intent");
    expect(toolNames).toContain("request_human_handoff");
  });
});

describe("runAgent — cachedTokens distingue ausente de cero (T8.2)", () => {
  // E14. Un 0 no podía interpretarse: podía ser "el caché no acierta" o "el proveedor no manda
  // `prompt_tokens_details`". El desglose existía justamente para poder decidir eso.
  it("proveedor que no informa → null, no 0", async () => {
    mockCount.mockResolvedValueOnce(0);
    mockCreate.mockResolvedValueOnce(textCompletion("ok")); // usage sin prompt_tokens_details

    const reply = await runAgent("a1", "hola");

    expect(reply.usageBreakdown?.cachedTokens).toBeNull();
  });

  it("proveedor que informa 0 → 0", async () => {
    mockCount.mockResolvedValueOnce(0);
    mockCreate.mockResolvedValueOnce({
      usage: { total_tokens: 5, prompt_tokens: 4, prompt_tokens_details: { cached_tokens: 0 } },
      choices: [{ message: { content: "ok", tool_calls: [] } }],
    });

    const reply = await runAgent("a1", "hola");

    expect(reply.usageBreakdown?.cachedTokens).toBe(0);
  });

  it("acumula entre iteraciones cuando informa", async () => {
    mockCount.mockResolvedValueOnce(0);
    mockExec.mockResolvedValueOnce({ ok: true });
    mockCreate
      .mockResolvedValueOnce({
        usage: { total_tokens: 10, prompt_tokens: 8, prompt_tokens_details: { cached_tokens: 100 } },
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "c1", type: "function", function: { name: "record_lead_intent", arguments: "{}" } },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        usage: { total_tokens: 5, prompt_tokens: 4, prompt_tokens_details: { cached_tokens: 250 } },
        choices: [{ message: { content: "ok", tool_calls: [] } }],
      });

    const reply = await runAgent("a1", "hola");

    expect(reply.usageBreakdown).toMatchObject({ cachedTokens: 350, iterations: 2 });
  });
});

describe("shouldPrefetchKnowledge (T1.1)", () => {
  it.each([
    ["¿precios?", true],
    ["cuanto cuesta un corte", true],
    ["Hola", false],
    ["gracias!", false],
    ["   ", false],
    ["", false],
  ])("%s → %s", (msg, expected) => {
    expect(shouldPrefetchKnowledge(msg as string)).toBe(expected);
  });
});

describe("buildKnowledgeBlock (T1.1)", () => {
  it("devuelve null sin fragmentos", () => {
    expect(buildKnowledgeBlock([])).toBeNull();
  });

  it("numera los fragmentos y omite la etiqueta de fuente cuando viene vacía", () => {
    const block = buildKnowledgeBlock([
      { source: "https://x.es", content: "uno" },
      { source: null, content: "dos" },
    ]) as string;

    expect(block).toContain("[1] fuente: https://x.es");
    expect(block).toContain("[2]\ndos");
    expect(block).not.toContain("[2] fuente:");
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

describe("runAgent — factory por runtime (F1 aa-openclaw-brain)", () => {
  it("runtime openai (por defecto/ausente): model = Agent.model, sin user, isOpenclaw=false", async () => {
    mockCreate.mockResolvedValueOnce(textCompletion("Hola humano"));

    await runAgent("a1", "hola", [], undefined, "conv-1");

    expect(mockGetClient).toHaveBeenCalledWith({
      runtime: undefined,
      agentId: "a1",
      // H2: el resolutor recibe además el tenant, su modo de credenciales y el modelo (que
      // decide el proveedor en modo byok). En "platform" nada de esto cambia el resultado.
      tenantId: "t1",
      credentialMode: "platform",
      model: "gpt-4o",
    });
    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe("gpt-4o"); // Agent.model — comportamiento intacto
    expect(call).not.toHaveProperty("user");
  });

  it("runtime openclaw: model pasa al target per-agente openclaw/aa-<agentId> (no Agent.model), sin temperature", async () => {
    mockAgent.mockResolvedValue(baseAgent({ runtime: "openclaw", model: "gpt-4o" }));
    mockCreate.mockResolvedValueOnce(textCompletion("hola desde el gateway"));

    const reply = await runAgent("a1", "hola", [], undefined, "conv-2");

    expect(mockGetClient).toHaveBeenCalledWith({
      runtime: "openclaw",
      agentId: "a1",
      tenantId: "t1",
      credentialMode: "platform",
      model: "gpt-4o",
    });
    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe("openclaw/aa-a1"); // target per-agente — sustituye SIEMPRE al Agent.model
    expect(call.model).not.toBe("gpt-4o");
    expect(call).not.toHaveProperty("temperature"); // "openclaw/aa-a1" no empieza por "gpt-4"
    // reasoning_effort NO se inyecta para openclaw: el choke-point vive en el
    // singleton `openai` de lib/openai.ts, y getClientForAgent devuelve un
    // cliente NUEVO (sin ese monkey-patch) para runtime="openclaw" — cubierto
    // en tests/openai-agent-client.test.ts sin mockear el módulo.
    expect(reply.model).toBe("openclaw/aa-a1");
  });

  it("runtime openclaw: pasa user=conversationId cuando hay conversación activa", async () => {
    mockAgent.mockResolvedValue(baseAgent({ runtime: "openclaw" }));
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await runAgent("a1", "hola", [], undefined, "conv-3");

    expect(mockCreate.mock.calls[0][0].user).toBe("conv-3");
  });

  it("runtime openclaw: sin conversationId no envía user (no hay valor estable que pasar)", async () => {
    mockAgent.mockResolvedValue(baseAgent({ runtime: "openclaw" }));
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await runAgent("a1", "hola");

    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("user");
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
// Unit tests directos de los helpers puros extraídos (AgenticRuntime: cubrir ramas).
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
    expect(s).toContain("record_lead_intent"); // intención siempre
    expect(s).toContain("request_human_handoff"); // handoff siempre
    expect(s).not.toContain("Recomendación basada en conocimiento"); // RAG off
    expect(s).not.toContain("Reserva de citas"); // booking off
    expect(s).not.toContain("Estado de pedidos"); // order-status off
  });

  // T8.1 (antes: "incluye la línea fija incluso con hasKnowledge=false"). La orden se retira
  // TAMBIÉN sin conocimiento indexado, porque desde T8.1 la herramienta ya no se ofrece en ese
  // caso: ordenar su uso solo podía costar una iteración de más para obtener `[]`.
  it("NO ordena search_knowledge con hasKnowledge=false (ya no se ofrece la tool)", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], false, null);
    expect(s).not.toContain("Usa search_knowledge antes de responder");
  });

  it("añade bloque RAG si hasKnowledge", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], true, null);
    expect(s).toContain("Recomendación basada en conocimiento");
  });

  // T1.2: con conocimiento indexado se retira la orden, que contradiría al bloque RAG.
  it("retira la línea fija de search_knowledge con hasKnowledge=true", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], true, null);
    expect(s).not.toContain("Usa search_knowledge antes de responder");
    expect(s).toContain("Llama a search_knowledge SOLO si necesitas información DISTINTA");
  });

  it("añade guía de booking si calendar es ejecutable", () => {
    const s = buildSystemPrompt(agent, makeCaps({ executableProviders: ["calendar"] }), [], false, null);
    expect(s).toContain("Reserva de citas");
  });

  it("añade bloque de estado de pedidos si orderStatusUrl", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], false, { orderStatusUrl: "https://x" } as any);
    expect(s).toContain("Estado de pedidos");
  });

  // T4.1: los datos del contacto YA NO viven en el bloque de sistema. Era el único dato variable
  // dentro de él y rompía el prefijo cacheable del proveedor. Ahora van en su propio mensaje al
  // final de `messages` — ver el describe de buildContextFactsBlock y E8.
  it("NO mete datos de contacto en el bloque de sistema (T4.1)", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], false, null);
    expect(s).not.toContain("Datos del contacto ya conocidos");
  });

  // AC1/AC2 (aa-agente-nombre-y-comprobar-estado): inyección aditiva del nombre.
  it("inyecta el nombre cuando agent.name está presente", () => {
    const named = { name: "Lucía", systemPrompt: "Sé útil", skills: [] };
    const s = buildSystemPrompt(named, makeCaps(), [], false, null);
    expect(s).toContain("Lucía");
    expect(s).toContain('Te llamas "Lucía"');
  });

  it("NO añade la línea de nombre cuando agent.name está vacío o ausente", () => {
    const unnamed = { name: "", systemPrompt: "Sé útil", skills: [] };
    const s = buildSystemPrompt(unnamed, makeCaps(), [], false, null);
    expect(s).not.toContain("Te llamas");
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

describe("runToolLoop — cierre en la misma vuelta con herramientas de acuse (T8.4)", () => {
  /**
   * E15. Medido en la BD de prod: 2 de los 7 últimos mensajes de AiAs llamaban a
   * `record_lead_intent` y costaban `iterations: 2`. La segunda llamada reenviaba el prompt entero
   * para leer `{"recorded":true}` y reescribir un texto que el modelo ya había emitido.
   */
  function ackCompletion(text: string | null, name = "record_lead_intent", tokens = 10) {
    return {
      usage: { total_tokens: tokens, prompt_tokens: tokens - 2 },
      choices: [
        {
          message: {
            content: text,
            tool_calls: [{ id: "c1", type: "function", function: { name, arguments: '{"intent":"plan Pro"}' } }],
          },
        },
      ],
    };
  }

  it("texto + sólo acuses ⇒ una iteración, y el efecto secundario ocurre igual", async () => {
    mockExec.mockResolvedValueOnce({ recorded: true, intent: "plan Pro" });
    mockCreate.mockResolvedValueOnce(ackCompletion("Genial, te cuento del plan Pro 😊"));

    const reply = await runAgent("a1", "quiero el plan Pro");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(reply.usageBreakdown?.iterations).toBe(1);
    expect(reply.text).toBe("Genial, te cuento del plan Pro 😊");
    // La herramienta se ejecutó: lo que se ahorra es la vuelta, no el efecto.
    expect(mockExec).toHaveBeenCalledWith("a1", "record_lead_intent", { intent: "plan Pro" }, undefined);
    expect(reply.toolCalls[0]).toMatchObject({ tool: "record_lead_intent" });
  });

  it("acuse SIN texto ⇒ sigue costando la segunda vuelta (no hay nada que devolver)", async () => {
    mockExec.mockResolvedValueOnce({ recorded: true });
    mockCreate
      .mockResolvedValueOnce(ackCompletion(null))
      .mockResolvedValueOnce(textCompletion("Genial", 5));

    const reply = await runAgent("a1", "quiero el plan Pro");

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(reply.text).toBe("Genial");
  });

  it("herramienta informativa ⇒ vuelve aunque haya texto: su output cambia la respuesta", async () => {
    // `request_human_handoff` devuelve `withinBusinessHours`, y de eso depende si toca decir
    // "te atienden ahora" o "mañana a las 9". No puede cerrarse en la primera vuelta.
    mockExec.mockResolvedValueOnce({ handed_off: true, withinBusinessHours: false });
    mockCreate
      .mockResolvedValueOnce(ackCompletion("Te paso con alguien", "request_human_handoff"))
      .mockResolvedValueOnce(textCompletion("Ahora no hay nadie; te escriben mañana a las 9", 5));

    const reply = await runAgent("a1", "quiero hablar con una persona");

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(reply.text).toBe("Ahora no hay nadie; te escriben mañana a las 9");
  });

  it("acuse que FALLA ⇒ vuelve: el error sí cambia lo que hay que decir", async () => {
    mockExec.mockRejectedValueOnce(new Error("metadata write failed"));
    mockCreate
      .mockResolvedValueOnce(ackCompletion("Anotado"))
      .mockResolvedValueOnce(textCompletion("Perdona, no pude anotarlo", 5));

    const reply = await runAgent("a1", "quiero el plan Pro");

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(reply.toolCalls[0].error).toBe("metadata write failed");
  });

  it("mezcla acuse + informativa ⇒ vuelve", async () => {
    mockExec.mockResolvedValue({ ok: true });
    mockCreate
      .mockResolvedValueOnce({
        usage: { total_tokens: 10, prompt_tokens: 8 },
        choices: [
          {
            message: {
              content: "Un momento",
              tool_calls: [
                { id: "c1", type: "function", function: { name: "record_lead_intent", arguments: "{}" } },
                { id: "c2", type: "function", function: { name: "search_knowledge", arguments: '{"query":"precio"}' } },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce(textCompletion("Cuesta 39 €", 5));

    const reply = await runAgent("a1", "cuanto cuesta el plan Pro");

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(reply.text).toBe("Cuesta 39 €");
  });
});
