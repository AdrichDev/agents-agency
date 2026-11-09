// S1–S4, S7 (odd/tasks/responses-api-migration.md) — ruta Responses API del bucle agéntico.
//
// El incidente que motiva este fichero: OpenAI retiró `gpt-4.1-nano` y, al pasar los agentes a
// `gpt-5.6-luna`, `/v1/chat/completions` rechaza function tools con razonamiento
// ("Function tools with reasoning_effort are not supported for gpt-5.6-luna"). Los modelos
// marcados en `model-capabilities.ts` tienen que salir por `/v1/responses` con el MISMO contrato
// de salida (`AgentReply`), y todos los demás por `chat.completions` exactamente como antes.
//
// Se prueba en dos capas:
//  - helpers puros (traducción de herramientas/entrada/uso y lectura de la respuesta), que es
//    donde vive el formato y por tanto donde un error se puede fijar con una tabla de casos;
//  - el bucle completo por `runAgent` con un doble de `responses.create`, que es la única forma
//    de comprobar lo que de verdad importa: que se reenvían los items de salida seguidos de los
//    `function_call_output` y que la respuesta final sale por las mismas guardas.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Los mocks replican los de `engine.test.ts` (misma forma que la ruta real): resolver de cliente
// por agente, executor, metering, BD y embeddings.
vi.mock("@/lib/openai", () => {
  const client = {
    chat: { completions: { create: vi.fn() } },
    responses: { create: vi.fn() },
  };
  return {
    openai: client,
    getClientForAgent: vi.fn(async () => ({ client, isOpenclaw: false })),
  };
});
vi.mock("@/lib/agent/executor", () => ({ executeTool: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ processNewLead: vi.fn() }));
vi.mock("@/lib/token-metering", () => ({
  deductTokens: vi.fn(),
  assertUsageAllowed: vi.fn(async (tenantId?: string | null) => ({
    meteredTenantId: tenantId ?? null,
    credentialMode: "platform",
  })),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(async () => null) },
    knowledgeChunk: { count: vi.fn() },
    agentSchedule: { findUnique: vi.fn(async () => ({ timezone: "Europe/Madrid" })) },
  },
}));
vi.mock("@/lib/embeddings", async () => {
  const real = await vi.importActual<typeof import("@/lib/embeddings")>("@/lib/embeddings");
  return { publicSource: real.publicSource, searchKnowledge: vi.fn(async () => []) };
});

import { openai, getClientForAgent } from "@/lib/openai";
import { executeTool } from "@/lib/agent/executor";
import { prisma } from "@/lib/db";
import { searchKnowledge } from "@/lib/embeddings";
import { runAgent } from "@/lib/agent/engine";
import { capsFor, resolveEffort } from "@/lib/model-capabilities";
// S5 (model-catalog): la ruta la decide el PROVEEDOR del modelo, así que la pregunta vive junto a
// `providerForModel` (`llm/governance.ts`) y no en la tabla de capacidades.
import { providerForModel, usesResponsesApi } from "@/lib/llm/governance";
import {
  RESPONSES_MAX_OUTPUT_TOKENS,
  accumulateResponsesUsage,
  buildResponsesBody,
  parseResponsesTurn,
  toResponsesInput,
  toResponsesTools,
} from "@/lib/agent/responses-loop";

const mockChatCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;
const mockResponsesCreate = (openai as unknown as { responses: { create: ReturnType<typeof vi.fn> } })
  .responses.create;
const mockGetClient = getClientForAgent as unknown as ReturnType<typeof vi.fn>;
const mockExec = executeTool as ReturnType<typeof vi.fn>;
const mockAgent = prisma.agent.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockCount = prisma.knowledgeChunk.count as ReturnType<typeof vi.fn>;
const mockSearch = searchKnowledge as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Dobles de la respuesta de /v1/responses.
// ---------------------------------------------------------------------------

type OutputItem = Record<string, unknown>;

function reasoningItem(encrypted = "cifrado-1"): OutputItem {
  return { type: "reasoning", id: "rs_1", summary: [], encrypted_content: encrypted, status: "completed" };
}

function functionCallItem(callId: string, name: string, args: string): OutputItem {
  return { type: "function_call", id: `fc_${callId}`, call_id: callId, name, arguments: args, status: "completed" };
}

function messageItem(text: string): OutputItem {
  return {
    type: "message",
    id: "msg_1",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

function usage(total: number, input: number, cached?: number) {
  return {
    total_tokens: total,
    input_tokens: input,
    output_tokens: total - input,
    ...(cached === undefined ? {} : { input_tokens_details: { cached_tokens: cached } }),
  };
}

function responsesReply(output: OutputItem[], u: Record<string, unknown> = usage(10, 8)) {
  return { id: "resp_1", object: "response", output, usage: u };
}

// ---------------------------------------------------------------------------
// Agente y comentarios de chat (mismos fixtures que engine.test.ts).
// ---------------------------------------------------------------------------

function baseAgent(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    name: "Bot",
    model: "gpt-5.6-luna",
    temperature: 0.5,
    systemPrompt: "Sé útil",
    status: "published",
    tenantId: "t1",
    ecommerceConfig: null,
    integrations: [],
    skills: [],
    ...over,
  };
}

function chatTextCompletion(content: string, tokens = 5) {
  return { usage: { total_tokens: tokens }, choices: [{ message: { content, tool_calls: [] } }] };
}

function chatToolCompletion(name: string, args: string, tokens = 10, id = "c1") {
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
  mockGetClient.mockResolvedValue({ client: openai, isOpenclaw: false });
});

// ---------------------------------------------------------------------------
// S1/S3 — catálogo: qué modelo sale por qué ruta y con qué effort.
// ---------------------------------------------------------------------------

describe("ruta por proveedor — «Todos por Responses API» (S1/S3 de responses-api-migration, S5)", () => {
  it("gpt-5.6-luna va por la Responses API y su effort por defecto es low", () => {
    expect(usesResponsesApi("gpt-5.6-luna")).toBe(true);
    expect(capsFor("gpt-5.6-luna").defaultEffort).toBe("low");
    expect(resolveEffort("gpt-5.6-luna")).toBe("low");
  });

  // S5 (model-catalog): antes sólo `gpt-5.6-luna` iba por `/v1/responses` porque era el único que
  // no aceptaba function tools en chat. La decisión de producto ahora es que TODO modelo del
  // proveedor OpenAI sale por ahí, así que la tabla de arriba pasa a ser una tabla de proveedores.
  it("TODO modelo del proveedor OpenAI va por la Responses API", () => {
    for (const model of [
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-3.5-turbo",
    ]) {
      expect(providerForModel(model), model).toBe("openai");
      expect(usesResponsesApi(model), model).toBe(true);
    }
  });

  it("gemini, claude y nanBuilders siguen por chat.completions (cero cambio)", () => {
    for (const model of [
      "gemini-3.1-pro-preview",
      "gemini-3.5-flash",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
      "nan/glm5.3-flash",
    ]) {
      expect(usesResponsesApi(model), model).toBe(false);
    }
  });

  it("sin id de modelo no se cambia de endpoint por accidente", () => {
    // `providerForModel(undefined)` cae en "openai" (comportamiento histórico del routing), pero
    // sin modelo no hay petición que enrutar: se queda en chat.
    expect(usesResponsesApi(undefined)).toBe(false);
    expect(usesResponsesApi("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers puros — formato de la petición.
// ---------------------------------------------------------------------------

const chatTool = {
  type: "function" as const,
  function: {
    name: "search_knowledge",
    description: "Busca en el conocimiento del negocio",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
};

describe("toResponsesTools (S1)", () => {
  it("aplana el esquema de chat al formato de /v1/responses con strict:false", () => {
    expect(toResponsesTools([chatTool])).toEqual([
      {
        type: "function",
        name: "search_knowledge",
        description: "Busca en el conocimiento del negocio",
        parameters: chatTool.function.parameters,
        strict: false,
      },
    ]);
  });

  it("conserva el orden y no muta las herramientas de entrada", () => {
    const second = {
      type: "function" as const,
      function: { name: "b", description: "B", parameters: { type: "object", properties: {} } },
    };
    const input = [chatTool, second];
    const out = toResponsesTools(input);
    expect(out.map((t) => t.name)).toEqual(["search_knowledge", "b"]);
    expect(input[0]).toBe(chatTool);
    expect(input[0]).not.toHaveProperty("strict");
  });

  it("sin herramientas no inventa ninguna", () => {
    expect(toResponsesTools([])).toEqual([]);
  });
});

describe("toResponsesInput (S2)", () => {
  it("traduce sistema, historial y usuario a items de entrada en el mismo orden", () => {
    const messages = [
      { role: "system", content: "Eres Bot" },
      { role: "user", content: "primero" },
      { role: "assistant", content: "segundo" },
      { role: "system", content: "Datos del contacto: Ana" },
      { role: "user", content: "tercero" },
    ];
    expect(toResponsesInput(messages)).toEqual(messages);
  });

  it("no añade `type` ni otros campos: el prefijo estable viaja idéntico", () => {
    const [item] = toResponsesInput([{ role: "system", content: "Eres Bot" }]);
    expect(Object.keys(item ?? {}).sort()).toEqual(["content", "role"]);
  });
});

describe("parseResponsesTurn (S1/S2)", () => {
  it("devuelve texto y llamadas a herramienta con su call_id", () => {
    const parsed = parseResponsesTurn(
      responsesReply([
        reasoningItem(),
        functionCallItem("call_1", "request_human_handoff", '{"reason":"quiere hablar"}'),
      ])
    );
    expect(parsed.toolCalls).toEqual([
      { callId: "call_1", name: "request_human_handoff", arguments: '{"reason":"quiere hablar"}' },
    ]);
    expect(parsed.text).toBe("");
  });

  it("extrae el texto de los items `message`/`output_text`", () => {
    const parsed = parseResponsesTurn(responsesReply([reasoningItem(), messageItem("Hola humano")]));
    expect(parsed.text).toBe("Hola humano");
    expect(parsed.toolCalls).toEqual([]);
  });

  it("concatena varios items de texto en orden", () => {
    const parsed = parseResponsesTurn(responsesReply([messageItem("Hola "), messageItem("humano")]));
    expect(parsed.text).toBe("Hola humano");
  });

  it("cae a `output_text` cuando el proveedor no manda items legibles", () => {
    const parsed = parseResponsesTurn({ output: [], output_text: "plan Pro" } as never);
    expect(parsed.text).toBe("plan Pro");
  });

  it("una respuesta vacía no revienta: texto vacío y ninguna llamada", () => {
    expect(parseResponsesTurn({ output: [] } as never)).toEqual({ text: "", toolCalls: [] });
    expect(parseResponsesTurn({} as never)).toEqual({ text: "", toolCalls: [] });
  });

  it("ignora items que no aportan texto ni llamadas (p. ej. razonamiento)", () => {
    const parsed = parseResponsesTurn(responsesReply([reasoningItem(), reasoningItem("cifrado-2")]));
    expect(parsed).toEqual({ text: "", toolCalls: [] });
  });
});

describe("accumulateResponsesUsage (S2)", () => {
  it("suma total e input, y pondera el caché cuando el proveedor lo informa", () => {
    const empty = { total: 0, prompt: 0, cached: null as number | null };
    const first = accumulateResponsesUsage(empty, usage(100, 80, 64));
    expect(first).toEqual({ total: 100, prompt: 80, cached: 64 });
  });

  it("si el proveedor no informa del caché, el acumulado no se inventa un 0", () => {
    const first = { total: 100, prompt: 80, cached: 64 as number | null };
    expect(accumulateResponsesUsage(first, usage(50, 40))).toEqual({ total: 150, prompt: 120, cached: 64 });
  });

  it("un 0 informado sí se acumula como 0 (distingue de ausente)", () => {
    const first = { total: 100, prompt: 80, cached: 64 as number | null };
    expect(accumulateResponsesUsage(first, usage(50, 40, 0))).toEqual({ total: 150, prompt: 120, cached: 64 });
  });

  it("una respuesta sin usage no rompe la suma", () => {
    const first = { total: 10, prompt: 8, cached: null };
    expect(accumulateResponsesUsage(first, undefined)).toEqual(first);
  });
});

describe("buildResponsesBody (S1/S3)", () => {
  it("no guarda estado, pide el razonamiento cifrado y fija el tope de salida", () => {
    const body = buildResponsesBody({
      model: "gpt-5.6-luna",
      input: [{ role: "system", content: "Eres Bot" }],
      tools: toResponsesTools([chatTool]),
      effort: "low",
    });
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      include: ["reasoning.encrypted_content"],
      max_output_tokens: 2048,
      reasoning: { effort: "low" },
      tools: [
        {
          type: "function",
          name: "search_knowledge",
          strict: false,
        },
      ],
    });
    expect(RESPONSES_MAX_OUTPUT_TOKENS).toBe(2048);
  });

  it("nunca manda temperature a un razonador (S3)", () => {
    const body = buildResponsesBody({ model: "gpt-5.6-luna", input: [], effort: "low" });
    expect(body).not.toHaveProperty("temperature");
  });

  it("sin effort en el catálogo no manda el bloque reasoning", () => {
    const body = buildResponsesBody({ model: "gpt-5.6-luna", input: [], effort: null });
    expect(body).not.toHaveProperty("reasoning");
  });

  it("un tope explícito sustituye al del bucle (llamadas sin herramientas)", () => {
    const body = buildResponsesBody({ model: "gpt-5.6-luna", input: [], maxOutputTokens: 256 });
    expect(body.max_output_tokens).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// S1/S2 — bucle completo por runAgent con doble de responses.create.
// ---------------------------------------------------------------------------

describe("runAgent — bucle Responses de 2 iteraciones con herramienta (S1/S2)", () => {
  it("usa responses.create, reenvía la salida y los function_call_output, y devuelve AgentReply", async () => {
    mockExec.mockResolvedValueOnce({ body: "x".repeat(20000) });
    mockResponsesCreate
      .mockResolvedValueOnce(
        responsesReply(
          [
            reasoningItem(),
            functionCallItem("call_1", "request_human_handoff", '{"reason":"quiere hablar con alguien"}'),
          ],
          usage(120, 80, 64)
        )
      )
      .mockResolvedValueOnce(responsesReply([reasoningItem("cifrado-2"), messageItem("Apuntado")], usage(30, 60)));

    const reply = await runAgent("a1", "quiero el plan Pro", [], undefined, "conv-1");

    // Ruta: la de Responses, no la de chat.completions.
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockResponsesCreate).toHaveBeenCalledTimes(2);

    // S1: petición sin estado, razonamiento cifrado, tope y herramientas planas.
    const body = mockResponsesCreate.mock.calls[0][0];
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      include: ["reasoning.encrypted_content"],
      max_output_tokens: 2048,
      reasoning: { effort: "low" },
    });
    expect(body).not.toHaveProperty("temperature");
    const toolNames = body.tools.map((t: any) => t.name);
    expect(toolNames).toContain("request_human_handoff");
    expect(body.tools.every((t: any) => t.type === "function" && typeof t.function === "undefined")).toBe(true);

    // S2: mismas piezas de sistema e historial, en el mismo orden.
    // OJO: `body.input` es el hilo VIVO del conductor (se reenvía entero y crece), así que se
    // mira por posición estable, no por `at(-1)`.
    expect(body.input[0]).toMatchObject({ role: "system" });
    expect(body.input[0].content).toContain("Bot");
    expect(body.input[1]).toMatchObject({ role: "user", content: "quiero el plan Pro" });

    // S1/L6: la segunda iteración reenvía el hilo completo — items de salida (razonamiento +
    // function_call) y, justo detrás, el resultado de la herramienta con su call_id.
    const input2 = mockResponsesCreate.mock.calls[1][0].input as any[];
    const fcIndex = input2.findIndex((i) => i.type === "function_call" && i.call_id === "call_1");
    expect(fcIndex).toBeGreaterThan(-1);
    expect(input2[fcIndex - 1]).toMatchObject({ type: "reasoning", encrypted_content: "cifrado-1" });
    const outIndex = input2.findIndex((i) => i.type === "function_call_output");
    expect(outIndex).toBe(fcIndex + 1);
    expect(input2[outIndex].call_id).toBe("call_1");

    // S2: el resultado de la herramienta viaja delimitado (frameUntrusted) y recortado a 12000.
    const framed = input2[outIndex].output as string;
    expect(framed).toContain("contenido no confiable");
    const raw = JSON.stringify({ body: "x".repeat(20000) });
    expect(framed).toContain(raw.slice(0, 12000));
    expect(framed).not.toContain(raw.slice(0, 12001));

    // S2: mismo registro de toolCalls y misma respuesta final.
    expect(mockExec).toHaveBeenCalledWith(
      "a1",
      "request_human_handoff",
      { reason: "quiere hablar con alguien" },
      "conv-1",
      expect.objectContaining({ contact: null })
    );
    expect(reply.toolCalls).toHaveLength(1);
    expect(reply.toolCalls[0]).toMatchObject({ tool: "request_human_handoff", output: { body: expect.any(String) } });
    expect(reply.text).toBe("Apuntado");
    expect(reply.model).toBe("gpt-5.6-luna");
    expect(reply.tokensUsed).toBe(150);
    expect(reply.usageBreakdown).toEqual({ promptTokens: 140, cachedTokens: 64, iterations: 2 });
  });

  it("el error de una herramienta no rompe el bucle (mismo contrato que chat)", async () => {
    mockExec.mockRejectedValueOnce(new Error("boom"));
    mockResponsesCreate
      .mockResolvedValueOnce(
        responsesReply([reasoningItem(), functionCallItem("call_1", "request_human_handoff", '{"reason":"x"}')])
      )
      .mockResolvedValueOnce(responsesReply([messageItem("seguimos")]));

    const reply = await runAgent("a1", "x");

    // Mismo registro que la ruta chat: si la tool falla, el input registrado es el argumento
    // crudo (no se llegó a parsear como válido) y el error viaja también al modelo.
    expect(reply.toolCalls[0]).toMatchObject({
      tool: "request_human_handoff",
      input: '{"reason":"x"}',
      output: { error: "boom" },
      error: "boom",
    });
    expect(reply.text).toBe("seguimos");
    // El modelo recibe el error como resultado de la herramienta, no como excepción.
    const input2 = mockResponsesCreate.mock.calls[1][0].input as any[];
    const out = input2.find((i) => i.type === "function_call_output");
    expect(out.output).toContain("boom");
  });

  it("la respuesta final sigue pasando por enforceCitations (S2)", async () => {
    const SRC = "https://bistro.es/horario";
    mockCount.mockResolvedValue(1);
    mockSearch.mockResolvedValue([
      { source: SRC, content: "Las reservas se aceptan hasta las 15:30.", distance: 0.1 },
    ]);
    mockResponsesCreate
      .mockResolvedValueOnce(
        responsesReply([reasoningItem(), functionCallItem("call_1", "search_knowledge", '{"query":"horario"}')])
      )
      .mockResolvedValueOnce(
        responsesReply([messageItem("La cocina cierra a las 15:45 los domingos (fuente: https://otro.es/x).")])
      );
    mockExec.mockResolvedValueOnce([
      { source: SRC, content: "Las reservas se aceptan hasta las 15:30.", distance: 0.1 },
    ]);

    const reply = await runAgent("a1", "¿A qué hora cierra la cocina los domingos?");

    expect(reply.text).toBe("La cocina cierra a las 15:45 los domingos.");
  });

  it("mantiene MAX_ITERATIONS y el mismo texto de agotamiento", async () => {
    mockExec.mockResolvedValue({ ok: true });
    mockResponsesCreate.mockResolvedValue(
      responsesReply([reasoningItem(), functionCallItem("call_1", "request_human_handoff", "{}")], usage(1, 1))
    );

    const reply = await runAgent("a1", "bucle");

    expect(reply.text).toContain("límite de pasos");
    expect(mockResponsesCreate).toHaveBeenCalledTimes(8);
    expect(reply.tokensUsed).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// S1/S4 — lo que NO puede cambiar: modelos no marcados y clientes sin Responses.
// ---------------------------------------------------------------------------

// El body de chat que se fija aquí es el de los proveedores que NO son OpenAI: desde S5 ningún
// modelo `gpt*` llega a `createChatDriver`, así que el caso "modelo openai por chat" ya no existe.
// Los fixtures usan gemini/nanBuilders/openclaw a propósito: son los que de verdad pasan por chat.
describe("runAgent — regresión: los proveedores no-OpenAI siguen por chat.completions (S5)", () => {
  it("gemini llama a chat.completions.create con el mismo body de siempre", async () => {
    mockAgent.mockResolvedValue(baseAgent({ model: "gemini-3.5-flash" }));
    mockChatCreate.mockResolvedValueOnce(chatTextCompletion("Hola humano", 7));

    const reply = await runAgent("a1", "hola");

    expect(mockResponsesCreate).not.toHaveBeenCalled();
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    const body = mockChatCreate.mock.calls[0][0];
    expect(body).toMatchObject({
      model: "gemini-3.5-flash",
      max_completion_tokens: 2048,
    });
    // El conductor de chat sólo manda temperature a `gpt-4*`, y esos ya no pasan por aquí.
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("store");
    // `body.messages` es el array VIVO del bucle (muta con cada iteración en las dos rutas, igual
    // que antes del cambio), así que se mira por posición estable.
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[1]).toMatchObject({ role: "user", content: "hola" });
    // El formato de herramienta de chat (anidado) sigue intacto.
    expect(body.tools[0]).toHaveProperty("function.name");
    expect(reply.text).toBe("Hola humano");
    expect(reply.tokensUsed).toBe(7);
  });

  it("un bucle con herramienta por chat.completions no cambia de forma", async () => {
    mockAgent.mockResolvedValue(baseAgent({ model: "gemini-3.5-flash" }));
    mockChatCreate
      .mockResolvedValueOnce(chatToolCompletion("request_human_handoff", "{}", 10))
      .mockResolvedValueOnce(chatTextCompletion("Apuntado", 5));
    mockExec.mockResolvedValueOnce({ ok: true });

    const reply = await runAgent("a1", "quiero el plan Pro");

    expect(mockResponsesCreate).not.toHaveBeenCalled();
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
    const messages2 = mockChatCreate.mock.calls[1][0].messages as any[];
    const toolIndex = messages2.findIndex((m) => m.role === "tool" && m.tool_call_id === "c1");
    expect(toolIndex).toBeGreaterThan(-1);
    // El turno del asistente con su tool_call va justo delante del resultado.
    expect(messages2[toolIndex - 1].tool_calls[0].id).toBe("c1");
    expect(reply.text).toBe("Apuntado");
    expect(reply.tokensUsed).toBe(15);
  });

  it("un modelo de nanBuilders sigue por chat.completions (proveedor interno)", async () => {
    mockAgent.mockResolvedValue(baseAgent({ model: "nan/glm5.3-flash" }));
    mockChatCreate.mockResolvedValueOnce(chatTextCompletion("Hola", 5));

    await runAgent("a1", "hola");

    expect(mockResponsesCreate).not.toHaveBeenCalled();
    const body = mockChatCreate.mock.calls[0][0];
    expect(body).toMatchObject({ model: "nan/glm5.3-flash", max_completion_tokens: 2048 });
    expect(body).not.toHaveProperty("store");
  });

  // El target de OpenClaw (`openclaw/aa-<id>` o un override como `openclaw/shared`) NO empieza por
  // `gemini`/`claude`/`nan`, así que `providerForModel` lo clasificaría como OpenAI. La guarda es
  // el runtime: un agente openclaw vive en su gateway, que sólo habla chat.completions.
  it("un agente openclaw sigue por chat aunque su modelo configurado sea de OpenAI", async () => {
    mockAgent.mockResolvedValue(baseAgent({ runtime: "openclaw", model: "gpt-5.4-mini" }));
    mockGetClient.mockResolvedValue({ client: openai, model: "openclaw/aa-a1", isOpenclaw: true });
    mockChatCreate.mockResolvedValueOnce(chatTextCompletion("desde el gateway", 6));

    const reply = await runAgent("a1", "hola", [], undefined, "conv-gw");

    expect(mockResponsesCreate).not.toHaveBeenCalled();
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    const body = mockChatCreate.mock.calls[0][0];
    expect(body.model).toBe("openclaw/aa-a1");
    expect(body.user).toBe("conv-gw");
    expect(body).not.toHaveProperty("store");
    expect(reply.model).toBe("openclaw/aa-a1");
    expect(reply.text).toBe("desde el gateway");
  });
});

describe("runAgent — cualquier modelo de OpenAI por Responses (S5)", () => {
  it("gpt-5.4-mini con herramienta: responses.create con store:false y tools planas", async () => {
    mockAgent.mockResolvedValue(baseAgent({ model: "gpt-5.4-mini" }));
    mockExec.mockResolvedValueOnce({ ok: true });
    mockResponsesCreate
      .mockResolvedValueOnce(
        responsesReply(
          [reasoningItem(), functionCallItem("call_1", "request_human_handoff", '{"reason":"x"}')],
          usage(120, 80, 64)
        )
      )
      .mockResolvedValueOnce(responsesReply([messageItem("Apuntado")], usage(30, 60)));

    const reply = await runAgent("a1", "quiero el plan Pro", [], undefined, "conv-1");

    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockResponsesCreate).toHaveBeenCalledTimes(2);
    const body = mockResponsesCreate.mock.calls[0][0];
    expect(body).toMatchObject({
      model: "gpt-5.4-mini",
      store: false,
      include: ["reasoning.encrypted_content"],
      max_output_tokens: 2048,
      // Effort del catálogo de gpt-5.4-mini (`none`), no el global.
      reasoning: { effort: "none" },
    });
    expect(body.tools.every((t: any) => t.type === "function" && typeof t.function === "undefined")).toBe(
      true
    );

    expect(reply.text).toBe("Apuntado");
    expect(reply.model).toBe("gpt-5.4-mini");
    expect(reply.tokensUsed).toBe(150);
    expect(reply.usageBreakdown).toEqual({ promptTokens: 140, cachedTokens: 64, iterations: 2 });
  });

  it("un modelo de OpenAI que no es razonador (gpt-4o) también sale por Responses", async () => {
    mockAgent.mockResolvedValue(baseAgent({ model: "gpt-4o" }));
    mockResponsesCreate.mockResolvedValueOnce(responsesReply([messageItem("Hola")], usage(9, 7)));

    const reply = await runAgent("a1", "hola");

    expect(mockChatCreate).not.toHaveBeenCalled();
    const body = mockResponsesCreate.mock.calls[0][0];
    expect(body).toMatchObject({ model: "gpt-4o", store: false });
    // Sin efforts declarados no hay bloque de razonamiento que mandar.
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("temperature");
    expect(reply.text).toBe("Hola");
    expect(reply.tokensUsed).toBe(9);
  });
});

describe("runAgent — cliente sin Responses falla cerrado (S4)", () => {
  it("un cliente sin responses.create rechaza con error claro y no cae a chat.completions", async () => {
    const chatOnly = { chat: { completions: { create: mockChatCreate } } };
    mockGetClient.mockResolvedValue({ client: chatOnly, isOpenclaw: false });

    await expect(runAgent("a1", "hola")).rejects.toMatchObject({
      status: 503,
      code: "LLM_RESPONSES_UNSUPPORTED",
    });
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });
});
