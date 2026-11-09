/**
 * S1 / S2 / S4 (conversation-persistence, T1) — caducidad de la sesión del VISITANTE.
 *
 * Lo que se fija aquí:
 *  - S1: una conversación del widget caduca cuando su última actividad es anterior a
 *    `CONVERSATION_SESSION_TTL_HOURS` (24 h por defecto). `chatWithAgent` deja de reanudarla y
 *    responde 410 `CONVERSATION_EXPIRED`, que es la señal que el widget interpreta como "empieza
 *    una conversación nueva". Los canales (telegram/whatsapp) NO caducan nunca: el hilo es de por
 *    vida del contacto.
 *  - S2: una conversación marcada como cerrada (`metadata.session.closedAt`) tampoco se reanuda,
 *    con el mismo 410.
 *  - S4: el historial que recibe el modelo sigue siendo de 16 mensajes, y eso se pina JUNTO con el
 *    410 de caducidad, en el mismo fichero y con el mismo montaje.
 *
 * Mismo patrón de mocks que tests/engine-context-window.test.ts.
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
    agent: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(async () => null) },
    agentSchedule: { findUnique: vi.fn(async () => ({ timezone: "Europe/Madrid" })) },
    knowledgeChunk: { count: vi.fn() },
    conversation: { create: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    message: { createMany: vi.fn(), findMany: vi.fn(async () => []) },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { chatWithAgent, HISTORY_WINDOW_MESSAGES } from "@/lib/agent/engine";
import {
  CONVERSATION_EXPIRED_CODE,
  DEFAULT_SESSION_TTL_HOURS,
  SESSION_CLOSED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  SESSION_TTL_HOURS,
  isConversationSessionClosed,
  isConversationSessionExpired,
  resolveSessionTtlHours,
  sessionEndGuard,
} from "@/lib/agent/conversation-session";

const mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;
const mockAgent = prisma.agent.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockCount = prisma.knowledgeChunk.count as ReturnType<typeof vi.fn>;
const mockConvFind = prisma.conversation.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockConvUnique = prisma.conversation.findUnique as ReturnType<typeof vi.fn>;
const mockConvUpdate = prisma.conversation.update as ReturnType<typeof vi.fn>;
const mockMsgCreateMany = prisma.message.createMany as ReturnType<typeof vi.fn>;
const mockLeadFind = prisma.lead.findUnique as ReturnType<typeof vi.fn>;

// ── Utilidades de tiempo ──────────────────────────────────────────────────────
// `now` se inyecta SIEMPRE: nada de leer el reloj dentro del test, o el borde de 24 h
// dependería del momento en que corre la suite.
const NOW = new Date("2026-06-01T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * HOUR_MS);

// El motor llama a `new Date()` de verdad, así que sus escenarios no pueden anclarse a `NOW`:
// una conversación "de hace una hora" tiene que serlo respecto al reloj real o el test caduca solo.
const realHoursAgo = (h: number): Date => new Date(Date.now() - h * HOUR_MS);

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

function textCompletion(content: string) {
  return { usage: { total_tokens: 5 }, choices: [{ message: { content, tool_calls: [] } }] };
}

/** Conversación tal y como la devuelve la consulta del motor (metadata + mensajes incluidos). */
function conversation(over: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    agentId: "a1",
    channel: "widget",
    metadata: {},
    createdAt: realHoursAgo(1),
    updatedAt: realHoursAgo(1),
    messages: [],
    ...over,
  };
}

/** Los N últimos mensajes persistidos, en orden descendente (como los pide el motor). */
function persistedTail(total: number, windowSize: number) {
  const all = Array.from({ length: total }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i + 1}`,
    createdAt: new Date(2026, 0, 1, 0, 0, i),
  }));
  return all.slice(-windowSize).reverse();
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

// ── TTL ──────────────────────────────────────────────────────────────────────

describe("TTL de la sesión", () => {
  it("sin env → 24 h por defecto", () => {
    expect(resolveSessionTtlHours(undefined)).toEqual({ hours: DEFAULT_SESSION_TTL_HOURS, invalid: false });
    expect(resolveSessionTtlHours("")).toEqual({ hours: DEFAULT_SESSION_TTL_HOURS, invalid: false });
    expect(resolveSessionTtlHours("   ")).toEqual({ hours: DEFAULT_SESSION_TTL_HOURS, invalid: false });
    expect(DEFAULT_SESSION_TTL_HOURS).toBe(24);
  });

  it("un valor válido se respeta", () => {
    expect(resolveSessionTtlHours("6")).toEqual({ hours: 6, invalid: false });
    expect(resolveSessionTtlHours(" 48 ")).toEqual({ hours: 48, invalid: false });
    expect(resolveSessionTtlHours("1.5")).toEqual({ hours: 1.5, invalid: false });
  });

  it("un valor inválido cae al default y se marca para avisar", () => {
    for (const raw of ["abc", "0", "-3", "NaN", "Infinity"]) {
      expect(resolveSessionTtlHours(raw), raw).toEqual({
        hours: DEFAULT_SESSION_TTL_HOURS,
        invalid: true,
      });
    }
  });

  it("el TTL en uso es un número positivo de horas", () => {
    expect(Number.isFinite(SESSION_TTL_HOURS)).toBe(true);
    expect(SESSION_TTL_HOURS).toBeGreaterThan(0);
  });
});

// ── Caducidad pura ───────────────────────────────────────────────────────────

describe("isConversationSessionExpired", () => {
  it("activa mientras no se alcanza el TTL", () => {
    expect(isConversationSessionExpired({ createdAt: hoursAgo(23.99) }, NOW)).toBe(false);
    expect(isConversationSessionExpired({ createdAt: hoursAgo(1) }, NOW)).toBe(false);
  });

  it("el límite es inclusivo: exactamente el TTL ya está caducada", () => {
    expect(isConversationSessionExpired({ createdAt: hoursAgo(SESSION_TTL_HOURS) }, NOW)).toBe(true);
  });

  it("caducada cuando la última actividad supera el TTL", () => {
    expect(isConversationSessionExpired({ createdAt: hoursAgo(30) }, NOW)).toBe(true);
  });

  it("la última actividad es updatedAt, no createdAt", () => {
    // Conversación vieja pero tocada hace una hora → sigue viva.
    expect(
      isConversationSessionExpired({ createdAt: hoursAgo(200), updatedAt: hoursAgo(1) }, NOW)
    ).toBe(false);
    // Conversación creada hace un rato pero sin actividad desde hace dos días → caducada.
    expect(
      isConversationSessionExpired({ createdAt: hoursAgo(1), updatedAt: hoursAgo(48) }, NOW)
    ).toBe(true);
  });

  it("sin actividad registrada no se puede afirmar caducidad", () => {
    expect(isConversationSessionExpired({}, NOW)).toBe(false);
    expect(isConversationSessionExpired({ createdAt: null, updatedAt: null }, NOW)).toBe(false);
  });
});

// ── Cierre explícito ─────────────────────────────────────────────────────────

describe("isConversationSessionClosed", () => {
  it("lee metadata.session.closedAt", () => {
    expect(isConversationSessionClosed({ metadata: { session: { closedAt: NOW.toISOString() } } })).toBe(
      true
    );
  });

  it("sin marca de cierre no está cerrada", () => {
    expect(isConversationSessionClosed({ metadata: {} })).toBe(false);
    expect(isConversationSessionClosed({ metadata: null })).toBe(false);
    expect(isConversationSessionClosed({})).toBe(false);
    expect(isConversationSessionClosed({ metadata: { session: {} } })).toBe(false);
    expect(isConversationSessionClosed({ metadata: { session: { closedAt: "" } } })).toBe(false);
    // El flujo de captación no es un cierre de sesión.
    expect(isConversationSessionClosed({ metadata: { leadFlow: { step: "closed" } } })).toBe(false);
  });
});

// ── Guardián ─────────────────────────────────────────────────────────────────

describe("sessionEndGuard", () => {
  it("conversación activa del widget → ok", () => {
    expect(sessionEndGuard(conversation(), NOW)).toEqual({ ok: true });
  });

  it("widget caducada → 410 CONVERSATION_EXPIRED", () => {
    expect(sessionEndGuard(conversation({ createdAt: hoursAgo(30), updatedAt: hoursAgo(30) }), NOW)).toEqual({
      ok: false,
      status: 410,
      code: CONVERSATION_EXPIRED_CODE,
      message: SESSION_EXPIRED_MESSAGE,
    });
  });

  it("widget cerrada → 410 CONVERSATION_EXPIRED", () => {
    expect(
      sessionEndGuard(conversation({ metadata: { session: { closedAt: NOW.toISOString() } } }), NOW)
    ).toEqual({
      ok: false,
      status: 410,
      code: CONVERSATION_EXPIRED_CODE,
      message: SESSION_CLOSED_MESSAGE,
    });
  });

  it("el código de error es el que espera el widget", () => {
    expect(CONVERSATION_EXPIRED_CODE).toBe("CONVERSATION_EXPIRED");
  });

  it("un canal sin caducidad nunca se cierra ni caduca", () => {
    const vieja = { createdAt: hoursAgo(24 * 400), updatedAt: hoursAgo(24 * 400) };
    const cerrada = { metadata: { session: { closedAt: NOW.toISOString() } } };
    for (const channel of ["telegram", "whatsapp", "openclaw"]) {
      expect(sessionEndGuard(conversation({ ...vieja, channel }), NOW), channel).toEqual({ ok: true });
      expect(sessionEndGuard(conversation({ ...cerrada, channel }), NOW), channel).toEqual({ ok: true });
    }
  });

  it("canal ausente se trata como widget (filas antiguas)", () => {
    expect(
      sessionEndGuard(conversation({ channel: null, createdAt: hoursAgo(30), updatedAt: hoursAgo(30) }), NOW)
    ).toMatchObject({
      ok: false,
      status: 410,
    });
  });
});

// ── Motor: el 410 corta el turno ─────────────────────────────────────────────

describe("chatWithAgent — caducidad", () => {
  it("no reanuda una conversación widget caducada: 410 sin gastar LLM ni escribir", async () => {
    mockConvFind.mockResolvedValue(
      conversation({ createdAt: realHoursAgo(30), updatedAt: realHoursAgo(30) })
    );

    await expect(chatWithAgent("a1", "hola", "conv-1", "widget")).rejects.toMatchObject({
      status: 410,
      code: CONVERSATION_EXPIRED_CODE,
      message: SESSION_EXPIRED_MESSAGE,
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockMsgCreateMany).not.toHaveBeenCalled();
  });

  it("no reanuda una conversación cerrada por el visitante: 410", async () => {
    mockConvFind.mockResolvedValue(
      conversation({
        createdAt: realHoursAgo(0.5),
        updatedAt: realHoursAgo(0.5),
        metadata: { session: { closedAt: realHoursAgo(0.01).toISOString() } },
      })
    );

    await expect(chatWithAgent("a1", "hola", "conv-1", "widget")).rejects.toMatchObject({
      status: 410,
      code: CONVERSATION_EXPIRED_CODE,
      message: SESSION_CLOSED_MESSAGE,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("una conversación activa se reanuda con normalidad", async () => {
    mockConvFind.mockResolvedValue(conversation({ createdAt: realHoursAgo(2), updatedAt: realHoursAgo(1) }));
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await expect(chatWithAgent("a1", "hola", "conv-1", "widget")).resolves.toMatchObject({
      conversationId: "conv-1",
      text: "ok",
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("una conversación de telegram no caduca nunca", async () => {
    mockConvFind.mockResolvedValue(
      conversation({
        channel: "telegram",
        createdAt: realHoursAgo(24 * 365),
        updatedAt: realHoursAgo(24 * 365),
      })
    );
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await expect(chatWithAgent("a1", "hola", "conv-1", "telegram")).resolves.toMatchObject({
      conversationId: "conv-1",
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

// ── S4: la ventana corta sigue intacta y el 410 la acompaña ──────────────────

describe("S4 — ventana de 16 mensajes + 410 de caducidad", () => {
  it("la conversación viva entrega exactamente los 16 últimos mensajes", async () => {
    mockConvFind.mockResolvedValue(
      conversation({
        createdAt: realHoursAgo(1),
        updatedAt: realHoursAgo(1),
        messages: persistedTail(40, HISTORY_WINDOW_MESSAGES),
      })
    );
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await chatWithAgent("a1", "última pregunta", "conv-1", "widget");

    const sent = (mockCreate.mock.calls[0][0] as { messages: { role: string; content: string }[] })
      .messages;
    const history = sent.filter((m) => m.role !== "system").slice(0, -1);
    expect(history).toHaveLength(HISTORY_WINDOW_MESSAGES);
    expect(history[0].content).toBe("m25");
    expect(history[history.length - 1].content).toBe("m40");
  });

  it("la misma conversación, caducada, corta con 410 antes de llegar al modelo", async () => {
    mockConvFind.mockResolvedValue(
      conversation({
        createdAt: realHoursAgo(24 * 5),
        updatedAt: realHoursAgo(24 * 5),
        messages: persistedTail(40, HISTORY_WINDOW_MESSAGES),
      })
    );

    await expect(chatWithAgent("a1", "última pregunta", "conv-1", "widget")).rejects.toMatchObject({
      status: 410,
      code: CONVERSATION_EXPIRED_CODE,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ── Preservar: el merge de metadata sigue sin pisar leadFlow ─────────────────

describe("metadata al reanudar", () => {
  it("el cierre del turno conserva lo que ya había (leadFlow incluido)", async () => {
    mockConvFind.mockResolvedValue(conversation({ createdAt: realHoursAgo(1), updatedAt: realHoursAgo(1) }));
    // Estado fresco en BD al cerrar el turno: una herramienta ya dejó su marca.
    mockConvUnique.mockResolvedValue({ metadata: { handoff: true } });
    mockCreate.mockResolvedValueOnce(textCompletion("ok"));

    await chatWithAgent("a1", "hola", "conv-1", "widget");

    const written = (mockConvUpdate.mock.calls.at(-1)![0] as { data: { metadata: any } }).data.metadata;
    expect(written.handoff).toBe(true);
    expect(written.leadFlow).toBeDefined();
  });
});
