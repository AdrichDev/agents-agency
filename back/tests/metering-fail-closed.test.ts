/**
 * H1 (aa-metering-fail-closed) — El gate de uso es fail-closed y vive en el motor.
 *
 * Antes de este change:
 *  - un agente sin tenant asignado consumía la cuenta LLM de la plataforma sin cupo,
 *    sin registro en `uso_tokens` y sin poder desactivarlo;
 *  - el saldo sólo se comprobaba en `POST /api/chat`, así que Telegram y WhatsApp
 *    (los otros dos llamadores de `chatWithAgent`) no pasaban por ningún control.
 *
 * Aquí se usa el `token-metering` REAL (con prisma mockeado) para probar el gate de verdad;
 * sólo `deductTokens` se espía, porque lo que se verifica es CONTRA QUÉ tenant se cobra.
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
// Gate real (assertUsageAllowed / checkClientBalance), contabilización espiada.
vi.mock("@/lib/token-metering", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/token-metering")>();
  return { ...actual, deductTokens: vi.fn() };
});
vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUniqueOrThrow: vi.fn() },
    // aa-reservas-fecha-y-zona-del-modelo: el motor resuelve la zona del negocio para anclar
    // la fecha de hoy en el prompt de sistema.
    agentSchedule: { findUnique: vi.fn(async () => ({ timezone: "Europe/Madrid" })) },
    tenant: { findUnique: vi.fn() },
    knowledgeChunk: { count: vi.fn() },
    conversation: {
      create: vi.fn(),
      // La escritura de metadata al cierre del turno hace merge contra la fila FRESCA.
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    message: { createMany: vi.fn() },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { assertUsageAllowed, deductTokens } from "@/lib/token-metering";
import { chatWithAgent } from "@/lib/agent/engine";
import { channelErrorMessage } from "@/lib/channels/webhook-shared";
import { HttpError } from "@/lib/http";

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
    // H3 (aa-agente-ciclo-vida-publicacion): estos tests miden el gate de SALDO, así que su
    // fixture tiene que estar publicado para llegar a él. El gate de publicación corre antes
    // (a propósito: un borrador sin cupo dice "no publicado", no "sin cupo").
    status: "published",
    ...over,
  };
}

function textCompletion(content: string, tokens = 5) {
  return { usage: { total_tokens: tokens }, choices: [{ message: { content, tool_calls: [] } }] };
}

/** Tenant activo con cupo disponible. */
function tenantConCupo() {
  // `credentialMode` (H2): la columna es NOT NULL con default 'platform', así que en la BD real
  // siempre viene. El fixture lo refleja para que el modo que ve el motor sea el de producción.
  return { isActive: true, tokenBalance: 1000, tokensUsed: 10, tokensUsedPeriod: 10, periodStart: new Date(), periodAnchorDay: 1, credentialMode: "platform" };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAgent.mockResolvedValue(baseAgent());
  mockTenant.mockResolvedValue(tenantConCupo());
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

describe("T1.1 — assertUsageAllowed (gate fail-closed)", () => {
  it("agente sin tenant es rechazado con 402", async () => {
    await expect(assertUsageAllowed(null)).rejects.toMatchObject({ status: 402 });
    await expect(assertUsageAllowed(undefined)).rejects.toBeInstanceOf(HttpError);
    // No llega a consultar el tenant: no hay tenant que consultar.
    expect(mockTenant).not.toHaveBeenCalled();
  });

  it("la consola de pruebas está exenta y devuelve null", async () => {
    // Sin tenant el modo es "platform": no hay cliente que traiga clave, así que ese consumo
    // es de la plataforma (H2).
    await expect(assertUsageAllowed(null, { isTest: true })).resolves.toEqual({
      meteredTenantId: null,
      credentialMode: "platform",
    });
  });

  it("la exención es acotada: con tenant, isTest NO salta el cupo", async () => {
    // Si eximiera, la consola sería una vía para seguir atendiendo a un tenant que dejó de
    // pagar — y deductTokens le seguiría cargando el consumo.
    mockTenant.mockResolvedValue({ isActive: false, tokenBalance: 1000, tokensUsed: 0, tokensUsedPeriod: 0, periodStart: new Date(), periodAnchorDay: 1 });
    await expect(assertUsageAllowed("tenant-1", { isTest: true })).rejects.toMatchObject({
      status: 402,
    });
  });

  it("tenant sin cupo propaga el corte de checkClientBalance (402)", async () => {
    mockTenant.mockResolvedValue({ isActive: true, tokenBalance: 100, tokensUsed: 100, tokensUsedPeriod: 100, periodStart: new Date(), periodAnchorDay: 1 });
    await expect(assertUsageAllowed("tenant-1")).rejects.toMatchObject({ status: 402 });
  });

  it("tenant desactivado (kill switch) es rechazado aunque tenga cupo", async () => {
    mockTenant.mockResolvedValue({ isActive: false, tokenBalance: 1000, tokensUsed: 0, tokensUsedPeriod: 0, periodStart: new Date(), periodAnchorDay: 1 });
    await expect(assertUsageAllowed("tenant-1")).rejects.toMatchObject({ status: 402 });
  });

  it("tenant activo con cupo devuelve su id", async () => {
    await expect(assertUsageAllowed("tenant-1")).resolves.toEqual({
      meteredTenantId: "tenant-1",
      credentialMode: "platform",
    });
  });
});

describe("T2.1 — no se gasta antes de cortar", () => {
  it("agente sin tenant: 402 y el cliente LLM no se invoca", async () => {
    mockAgent.mockResolvedValue(baseAgent({ tenantId: null }));

    await expect(chatWithAgent("a1", "hola", undefined, "widget")).rejects.toMatchObject({
      status: 402,
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockDeduct).not.toHaveBeenCalled();
  });

  it("tenant bloqueado: no se crea Conversation (sin escritura desde ruta pública)", async () => {
    mockTenant.mockResolvedValue({ isActive: false, tokenBalance: 1000, tokensUsed: 0, tokensUsedPeriod: 0, periodStart: new Date(), periodAnchorDay: 1 });

    await expect(chatWithAgent("a1", "hola", undefined, "widget")).rejects.toMatchObject({
      status: 402,
    });

    expect(mockConvCreate).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("T2.3 — fail-open por canal (el bug grave)", () => {
  it("Telegram descuenta sin que el llamador pase clientId", async () => {
    mockConvCreate.mockResolvedValue({
      id: "conv-tg",
      agentId: "a1",
      channel: "telegram",
      metadata: {},
      messages: [],
    });
    mockCreate.mockResolvedValueOnce(textCompletion("Hola", 31));

    // Firma exacta del webhook de Telegram: sin 5º parámetro (clientId).
    const reply = await chatWithAgent("a1", "hola", undefined, "telegram");

    expect(reply.text).toBe("Hola");
    expect(mockDeduct).toHaveBeenCalledWith("tenant-1", "a1", "conv-tg", 31, "gpt-4o", undefined, "platform", expect.anything());
  });

  it("WhatsApp con tenant bloqueado es cortado igual que el widget", async () => {
    mockTenant.mockResolvedValue({ isActive: true, tokenBalance: 50, tokensUsed: 50, tokensUsedPeriod: 50, periodStart: new Date(), periodAnchorDay: 1 });

    await expect(chatWithAgent("a1", "hola", undefined, "whatsapp")).rejects.toMatchObject({
      status: 402,
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("el tenant a cobrar sale de la BD, no del clientId del llamador", async () => {
    mockConvCreate.mockResolvedValue({
      id: "conv-x",
      agentId: "a1",
      channel: "widget",
      metadata: {},
      messages: [],
    });
    mockCreate.mockResolvedValueOnce(textCompletion("ok", 7));

    // Un llamador pasa un tenant ajeno; debe ignorarse (parámetro deprecado).
    await chatWithAgent("a1", "hola", undefined, "widget", "tenant-IMPOSTOR");

    expect(mockDeduct).toHaveBeenCalledWith("tenant-1", "a1", "conv-x", 7, "gpt-4o", undefined, "platform", expect.anything());
  });
});

describe("no filtrar el tenant interno por la ruta pública", () => {
  it("la respuesta de chatWithAgent no incluye meteredTenantId", async () => {
    mockConvCreate.mockResolvedValue({
      id: "conv-leak",
      agentId: "a1",
      channel: "widget",
      metadata: {},
      messages: [],
    });
    mockCreate.mockResolvedValueOnce(textCompletion("ok", 3));

    const reply = await chatWithAgent("a1", "hola", undefined, "widget");

    // `POST /api/chat` es público y reenvía esto tal cual al widget del cliente.
    expect(reply).not.toHaveProperty("meteredTenantId");
    // Pero el cobro sí se hizo contra el tenant real.
    expect(mockDeduct).toHaveBeenCalledWith("tenant-1", "a1", "conv-leak", 3, "gpt-4o", undefined, "platform", expect.anything());
  });
});

describe("T3.2 — mensaje al usuario final en canales de mensajería", () => {
  it("un 402 explica el motivo real (no parece una caída del sistema)", () => {
    const msg = channelErrorMessage(new HttpError(402, "Límite de uso del asistente excedido."));
    expect(msg).toBe("Límite de uso del asistente excedido.");
  });

  it("cualquier otro fallo mantiene el mensaje genérico (no filtra internos)", () => {
    expect(channelErrorMessage(new Error("ECONNREFUSED postgres:5432"))).toBe(
      "Lo siento, ha ocurrido un error."
    );
    expect(channelErrorMessage(new HttpError(500, "prisma: connection pool timeout"))).toBe(
      "Lo siento, ha ocurrido un error."
    );
  });
});

describe("T2.2 — exención de la consola de pruebas", () => {
  it("agente huérfano en modo test responde y no descuenta", async () => {
    mockAgent.mockResolvedValue(baseAgent({ tenantId: null }));
    mockConvCreate.mockResolvedValue({
      id: "conv-test",
      agentId: "a1",
      channel: "widget",
      metadata: {},
      messages: [],
    });
    mockCreate.mockResolvedValueOnce(textCompletion("Respuesta de prueba", 12));

    const reply = await chatWithAgent("a1", "hola", undefined, "widget", undefined, true);

    expect(reply.text).toBe("Respuesta de prueba");
    // Sin tenant no hay a quién cobrar: el coste es de plataforma (se acota en H4).
    expect(mockDeduct).not.toHaveBeenCalled();
  });

  it("modo test CON tenant sigue descontando (regresión F1/AC6)", async () => {
    mockConvCreate.mockResolvedValue({
      id: "conv-test2",
      agentId: "a1",
      channel: "widget",
      metadata: {},
      messages: [],
    });
    mockCreate.mockResolvedValueOnce(textCompletion("ok", 9));

    await chatWithAgent("a1", "hola", undefined, "widget", undefined, true);

    expect(mockDeduct).toHaveBeenCalledWith("tenant-1", "a1", "conv-test2", 9, "gpt-4o", undefined, "platform", expect.anything());
  });
});
