/**
 * C / D / F (aa-agentes-economia-tokens) — T3.1, T4.1 y T6.1.
 *
 * Caracteriza `chatWithAgent` en tres frentes que sólo se ven desde aquí (runAgent no carga la
 * conversación ni imputa el consumo):
 *
 *  - T3.1 la ventana de historial coge la COLA, no la cabeza. Antes `orderBy: { createdAt: "asc" }`
 *    con `take: 20` devolvía los 20 mensajes más ANTIGUOS: pasada esa marca el agente dejaba de ver
 *    los últimos turnos y releía el arranque para siempre.
 *  - T4.1 `contextFacts` sale del bloque de sistema. Era el único dato variable dentro de él, y el
 *    caché de prefijo del proveedor casa por prefijo EXACTO: en cuanto el visitante decía su nombre,
 *    el bloque entero dejaba de acertar en caché el resto de la conversación.
 *  - T6.1 se registra el desglose real del consumo (entrada, servido de caché, vueltas del bucle) en
 *    `TokenUsage.contexto`, sin cambiar lo que se imputa al cupo del cliente.
 *
 * Mismo patrón de mocks que tests/chat-mode-and-latency.test.ts.
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
vi.mock("@/lib/token-metering", () => ({
  deductTokens: vi.fn(),
  assertUsageAllowed: vi.fn(async (tenantId?: string | null) => ({
    meteredTenantId: tenantId ?? null,
    credentialMode: "platform",
  })),
}));
vi.mock("@/lib/embeddings", () => ({ searchKnowledge: vi.fn(async () => []) }));
vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUniqueOrThrow: vi.fn() },
    // aa-reservas-fecha-y-zona-del-modelo: el motor resuelve la zona del negocio para anclar
    // la fecha de hoy en el prompt de sistema.
    agentSchedule: { findUnique: vi.fn(async () => ({ timezone: "Europe/Madrid" })) },
    knowledgeChunk: { count: vi.fn() },
    conversation: { create: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    message: { createMany: vi.fn() },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { deductTokens } from "@/lib/token-metering";
import { chatWithAgent, buildContextFactsBlock, HISTORY_WINDOW_MESSAGES } from "@/lib/agent/engine";

const mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;
const mockAgent = prisma.agent.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockCount = prisma.knowledgeChunk.count as ReturnType<typeof vi.fn>;
const mockConvFind = prisma.conversation.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockConvUnique = prisma.conversation.findUnique as ReturnType<typeof vi.fn>;
const mockConvUpdate = prisma.conversation.update as ReturnType<typeof vi.fn>;
const mockMsgCreateMany = prisma.message.createMany as ReturnType<typeof vi.fn>;
const mockLeadFind = prisma.lead.findUnique as ReturnType<typeof vi.fn>;
const mockDeduct = deductTokens as unknown as ReturnType<typeof vi.fn>;

function baseAgent(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    name: "Bot",
    model: "gpt-4o",
    temperature: 0.5,
    systemPrompt: "Sé útil",
    status: "published",
    tenantId: "tenant-1",
    ecommerceConfig: null,
    integrations: [],
    skills: [],
    ...over,
  };
}

function textCompletion(content: string, usage: Record<string, unknown> = { total_tokens: 5 }) {
  return { usage, choices: [{ message: { content, tool_calls: [] } }] };
}

/** Los mensajes tal y como los devolvería la consulta: los N últimos, en orden descendente. */
function persistedTail(total: number, windowSize: number) {
  const all = Array.from({ length: total }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i + 1}`,
    createdAt: new Date(2026, 0, 1, 0, 0, i),
  }));
  return all.slice(-windowSize).reverse();
}

function conversation(messages: unknown[]) {
  return { id: "conv-1", agentId: "a1", channel: "widget", metadata: {}, messages };
}

/** Contenido de los mensajes enviados al LLM en la llamada `n` (0-indexada). */
function sentMessages(n = 0): { role: string; content: string }[] {
  return (mockCreate.mock.calls[n][0] as { messages: { role: string; content: string }[] }).messages;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAgent.mockResolvedValue(baseAgent());
  mockCount.mockResolvedValue(0);
  mockLeadFind.mockResolvedValue(null);
  mockConvUnique.mockResolvedValue({ metadata: {} });
  mockConvUpdate.mockResolvedValue({});
  mockMsgCreateMany.mockResolvedValue({});
});

describe("ventana de historial — T3.1", () => {
  // E6
  it("pide los ÚLTIMOS mensajes, no los primeros", async () => {
    mockConvFind.mockResolvedValue(conversation([]));
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await chatWithAgent("a1", "hola", "conv-1", "widget", "tenant-1");

    const arg = mockConvFind.mock.calls[0][0] as any;
    expect(arg.include.messages.orderBy[0]).toEqual({ createdAt: "desc" });
    expect(arg.include.messages.take).toBe(HISTORY_WINDOW_MESSAGES);
  });

  it("desempata por id: el par user/assistant de un turno comparte createdAt", async () => {
    mockConvFind.mockResolvedValue(conversation([]));
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await chatWithAgent("a1", "hola", "conv-1", "widget", "tenant-1");

    // Sin segundo criterio, `now()` de la transacción hace que Postgres pueda devolver la
    // respuesta del agente ANTES de la pregunta del usuario.
    const arg = mockConvFind.mock.calls[0][0] as any;
    expect(arg.include.messages.orderBy[1]).toEqual({ id: "desc" });
  });

  // E6: de 40 mensajes persistidos, el modelo recibe 25..40 en orden cronológico.
  it("entrega los 16 últimos en orden cronológico, no invertidos", async () => {
    mockConvFind.mockResolvedValue(conversation(persistedTail(40, HISTORY_WINDOW_MESSAGES)));
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await chatWithAgent("a1", "última pregunta", "conv-1", "widget", "tenant-1");

    const contents = sentMessages()
      .filter((m) => m.role !== "system")
      .map((m) => m.content);
    // El bloque de sistema va primero, el mensaje del usuario último, y en medio el historial.
    expect(contents[0]).toBe("m25");
    expect(contents[HISTORY_WINDOW_MESSAGES - 1]).toBe("m40");
    expect(contents[HISTORY_WINDOW_MESSAGES]).toBe("última pregunta");
    expect(contents).not.toContain("m1");
  });

  // E7: truncar el historial no puede perder al contacto.
  it("truncar el historial no pierde nombre ni email del contacto", async () => {
    mockConvFind.mockResolvedValue(
      conversation(persistedTail(40, HISTORY_WINDOW_MESSAGES))
    );
    mockLeadFind.mockResolvedValue({ email: "ana@x.com", phone: "600111222" });
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await chatWithAgent("a1", "y el precio?", "conv-1", "widget", "tenant-1");

    const all = sentMessages().map((m) => m.content).join("\n");
    expect(all).toContain("ana@x.com");
    expect(all).toContain("600111222");
  });
});

describe("prefijo estable — T4.1", () => {
  // E8
  it("los datos del contacto van en un mensaje de la cola, no en el bloque de sistema", async () => {
    mockConvFind.mockResolvedValue(conversation([]));
    mockLeadFind.mockResolvedValue({ email: "ana@x.com", phone: null });
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await chatWithAgent("a1", "hola", "conv-1", "widget", "tenant-1");

    const msgs = sentMessages();
    expect(msgs[0].content).not.toContain("ana@x.com");
    expect(msgs[msgs.length - 2].content).toContain("Datos del contacto ya conocidos: email: ana@x.com");
    expect(msgs[msgs.length - 1].content).toBe("hola");
  });

  // E8: el bloque de sistema es idéntico carácter a carácter aunque aparezca un dato nuevo.
  it("el bloque de sistema no cambia cuando se descubre el email a mitad de conversación", async () => {
    mockConvFind.mockResolvedValue(conversation([]));
    mockCreate.mockResolvedValue(textCompletion("ok"));

    mockLeadFind.mockResolvedValueOnce(null);
    await chatWithAgent("a1", "primer mensaje", "conv-1", "widget", "tenant-1");

    mockLeadFind.mockResolvedValueOnce({ email: "ana@x.com", phone: null });
    await chatWithAgent("a1", "segundo mensaje", "conv-1", "widget", "tenant-1");

    expect(sentMessages(1)[0].content).toBe(sentMessages(0)[0].content);
  });

  // E12: sin conocimiento y sin contacto, la cola está vacía y el prompt queda como antes.
  it("sin conocimiento ni contacto no se añade ningún mensaje extra", async () => {
    mockConvFind.mockResolvedValue(conversation([]));
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await chatWithAgent("a1", "hola", "conv-1", "widget", "tenant-1");

    const msgs = sentMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1]).toEqual({ role: "user", content: "hola" });
  });
});

describe("buildContextFactsBlock — T4.1", () => {
  it("devuelve null sin datos", () => {
    expect(buildContextFactsBlock(undefined)).toBeNull();
    expect(buildContextFactsBlock(null)).toBeNull();
    expect(buildContextFactsBlock("   ")).toBeNull();
  });

  it("conserva literalmente el texto que llevaba el bloque de sistema", () => {
    expect(buildContextFactsBlock("nombre: Ana, email: a@b.c")).toBe(
      "Datos del contacto ya conocidos: nombre: Ana, email: a@b.c. Úsalos, no los vuelvas a pedir."
    );
  });
});

describe("desglose de consumo — T6.1", () => {
  // E10
  it("registra cached_tokens en TokenUsage.contexto sin cambiar lo imputado", async () => {
    mockConvFind.mockResolvedValue(conversation([]));
    mockCreate.mockResolvedValueOnce(
      textCompletion("ok", {
        total_tokens: 2400,
        prompt_tokens: 2300,
        prompt_tokens_details: { cached_tokens: 1792 },
      })
    );

    await chatWithAgent("a1", "hola", "conv-1", "widget", "tenant-1");

    const args = mockDeduct.mock.calls[0];
    // Lo imputado al cupo sigue siendo total_tokens (4.º argumento). Sin cambio de política.
    expect(args[3]).toBe(2400);
    expect(args[7]).toEqual({ promptTokens: 2300, cachedTokens: 1792, iterations: 1 });
  });

  // E11 — T8.2 corrige el valor esperado: `null`, no `0`. Un 0 aquí afirmaba que el proveedor
  // había informado y el caché no había acertado, cuando lo cierto es que no informó de nada.
  // El instrumento tiene que poder distinguir las dos cosas o no sirve para decidir sobre caché.
  it("una respuesta sin prompt_tokens_details no rompe y registra cachedTokens null", async () => {
    mockConvFind.mockResolvedValue(conversation([]));
    mockCreate.mockResolvedValueOnce(textCompletion("ok", { total_tokens: 900, prompt_tokens: 800 }));

    await chatWithAgent("a1", "hola", "conv-1", "widget", "tenant-1");

    const args = mockDeduct.mock.calls[0];
    expect(args[3]).toBe(900);
    expect(args[7]).toEqual({ promptTokens: 800, cachedTokens: null, iterations: 1 });
  });

  it("una respuesta sin usage tampoco rompe", async () => {
    mockConvFind.mockResolvedValue(conversation([]));
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "ok", tool_calls: [] } }] });

    await expect(chatWithAgent("a1", "hola", "conv-1", "widget", "tenant-1")).resolves.toBeTruthy();
    // tokensUsed === 0 ⇒ deductTokens no se llama, igual que antes del change.
    expect(mockDeduct).not.toHaveBeenCalled();
  });
});

// ── Escritura de metadata al cierre del turno ─────────────────────────────────
//
// Fallo real, encontrado midiendo la BD de producción: la única conversación que llegó a ejecutar
// `request_human_handoff` acabó SIN `metadata.handoff === true`, aunque `executor.ts` lo escribe al
// atender esa herramienta. Causa: `chatWithAgent` leía el metadata al ABRIR el turno y al cerrarlo
// escribía `{ ...ese snapshot, leadFlow }`, así que borraba todo lo que las herramientas hubieran
// guardado por el camino. El flag es justo el que `service.ts` publica en el listado de leads: el
// panel del cliente nunca marcaba como escalado un lead escalado.
describe("metadata al cerrar el turno", () => {
  it("no pisa lo que las herramientas escribieron durante el turno", async () => {
    // Snapshot de apertura: metadata vacío.
    mockConvFind.mockResolvedValue(conversation([]));
    // Estado en BD cuando se cierra el turno: una herramienta ya dejó su marca.
    mockConvUnique.mockResolvedValue({ metadata: { handoff: true } });
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await chatWithAgent("a1", "hola", "conv-1", "widget", "tenant-1");

    const written = (mockConvUpdate.mock.calls.at(-1)![0] as any).data.metadata;
    expect(written.handoff).toBe(true);
    expect(written.leadFlow).toBeDefined();
  });

  it("escribe leadFlow igual cuando no hay nada previo que preservar", async () => {
    mockConvFind.mockResolvedValue(conversation([]));
    mockConvUnique.mockResolvedValue({ metadata: {} });
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await chatWithAgent("a1", "hola", "conv-1", "widget", "tenant-1");

    const written = (mockConvUpdate.mock.calls.at(-1)![0] as any).data.metadata;
    expect(written.leadFlow).toBeDefined();
  });
});
