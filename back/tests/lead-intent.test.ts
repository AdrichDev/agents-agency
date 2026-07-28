// T8.6 (aa-agentes-economia-tokens) — derivación de `leadIntent` fuera del bucle agéntico.
//
// La tool `record_lead_intent` costaba una segunda llamada al LLM por cada mensaje con intención
// de compra, y su output era un eco de su propio argumento. Estas pruebas fijan el contrato del
// reemplazo: se paga una sola vez por conversación, sólo si hay lead, siempre se contabiliza, y
// nunca rompe el chat.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/openai", () => {
  const client = { chat: { completions: { create: vi.fn() } } };
  return {
    openai: client,
    getClientForAgent: vi.fn(async () => ({ client, isOpenclaw: false })),
  };
});
vi.mock("@/lib/token-metering", () => ({ deductTokens: vi.fn(async () => undefined) }));
vi.mock("@/lib/agent/handoff", () => ({
  getConversationMetadata: vi.fn(async () => ({})),
  mergeConversationMetadata: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    lead: { findUnique: vi.fn() },
    message: { findMany: vi.fn() },
  },
}));

import { openai, getClientForAgent } from "@/lib/openai";
import { deductTokens } from "@/lib/token-metering";
import { getConversationMetadata, mergeConversationMetadata } from "@/lib/agent/handoff";
import { prisma } from "@/lib/db";
import { inferLeadIntent } from "@/lib/agent/lead-intent";

const mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;
const mockGetClient = getClientForAgent as unknown as ReturnType<typeof vi.fn>;
const mockDeduct = deductTokens as unknown as ReturnType<typeof vi.fn>;
const mockGetMeta = getConversationMetadata as unknown as ReturnType<typeof vi.fn>;
const mockMergeMeta = mergeConversationMetadata as unknown as ReturnType<typeof vi.fn>;
const mockLead = prisma.lead.findUnique as ReturnType<typeof vi.fn>;
const mockMessages = prisma.message.findMany as ReturnType<typeof vi.fn>;

const PARAMS = {
  agentId: "a1",
  conversationId: "conv-1",
  model: "gpt-5.4-mini",
  tenantId: "t1",
  credentialMode: "platform",
};

function completion(content: string | null, tokens = 300) {
  return { usage: { total_tokens: tokens }, choices: [{ message: { content } }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMeta.mockResolvedValue({});
  mockLead.mockResolvedValue({ id: "lead-1" });
  // La consulta real usa `orderBy: desc`, así que el fixture va del más NUEVO al más viejo.
  mockMessages.mockResolvedValue([
    { role: "user", content: "Quiero el plan Pro" },
    { role: "assistant", content: "¿En qué te ayudo?" },
  ]);
  mockGetClient.mockResolvedValue({ client: openai, isOpenclaw: false });
  mockCreate.mockResolvedValue(completion("plan Pro"));
});

describe("inferLeadIntent — camino feliz", () => {
  it("persiste la etiqueta en la metadata de la conversación", async () => {
    await inferLeadIntent(PARAMS);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockMergeMeta).toHaveBeenCalledWith("conv-1", { leadIntent: "plan Pro" });
  });

  it("manda la transcripción en orden cronológico, no el que devuelve la consulta", async () => {
    // La consulta pide `desc` (los ÚLTIMOS mensajes); el modelo tiene que verlos al revés o la
    // conversación le llega del final al principio.
    await inferLeadIntent(PARAMS);
    const user = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(user.indexOf("¿En qué te ayudo?")).toBeLessThan(user.indexOf("Quiero el plan Pro"));
  });

  it("acota la salida: es una etiqueta de columna, no una frase", async () => {
    await inferLeadIntent(PARAMS);
    expect(mockCreate.mock.calls[0][0].max_completion_tokens).toBe(32);
  });

  it("trunca una etiqueta desbocada antes de persistirla", async () => {
    mockCreate.mockResolvedValue(completion("x".repeat(500)));
    await inferLeadIntent(PARAMS);
    expect((mockMergeMeta.mock.calls[0][1] as any).leadIntent).toHaveLength(120);
  });
});

describe("inferLeadIntent — cortes que evitan gasto", () => {
  it("idempotente: si `leadIntent` ya está, no llama al LLM", async () => {
    mockGetMeta.mockResolvedValue({ leadIntent: "plan Pro" });
    await inferLeadIntent(PARAMS);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockMergeMeta).not.toHaveBeenCalled();
  });

  it("sin lead en la conversación no hay columna que rellenar → no gasta", async () => {
    mockLead.mockResolvedValue(null);
    await inferLeadIntent(PARAMS);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("sin ningún mensaje del visitante no hay intención que extraer → no gasta", async () => {
    mockMessages.mockResolvedValue([{ role: "assistant", content: "Hola" }]);
    await inferLeadIntent(PARAMS);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("`NINGUNA` no se persiste, pero sí se contabiliza lo gastado", async () => {
    mockCreate.mockResolvedValue(completion("NINGUNA"));
    await inferLeadIntent(PARAMS);
    expect(mockMergeMeta).not.toHaveBeenCalled();
    expect(mockDeduct).toHaveBeenCalled();
  });
});

describe("inferLeadIntent — contabilidad (H1) y credenciales (H2)", () => {
  it("imputa al tenant con operación `lead_intent`", async () => {
    await inferLeadIntent(PARAMS);
    expect(mockDeduct).toHaveBeenCalledWith(
      "t1",
      "a1",
      "conv-1",
      300,
      "gpt-5.4-mini",
      "lead_intent",
      "platform"
    );
  });

  it("contabiliza ANTES de saber si el resultado sirve", async () => {
    // Un consumo que no se registra por haber salido vacío es consumo invisible: rompería H1.
    mockCreate.mockResolvedValue(completion(null, 250));
    await inferLeadIntent(PARAMS);
    expect(mockDeduct).toHaveBeenCalledWith(
      "t1",
      "a1",
      "conv-1",
      250,
      "gpt-5.4-mini",
      "lead_intent",
      "platform"
    );
  });

  it("una prueba de consola no imputa cupo", async () => {
    await inferLeadIntent({ ...PARAMS, isTest: true });
    expect(mockCreate).toHaveBeenCalled();
    expect(mockDeduct).not.toHaveBeenCalled();
  });

  it("un agente sin tenant no imputa a nadie", async () => {
    await inferLeadIntent({ ...PARAMS, tenantId: null });
    expect(mockDeduct).not.toHaveBeenCalled();
  });

  it("propaga modo de credenciales y modelo al resolutor de cliente (byok)", async () => {
    await inferLeadIntent({ ...PARAMS, credentialMode: "byok", runtime: "openai" });
    expect(mockGetClient).toHaveBeenCalledWith({
      agentId: "a1",
      model: "gpt-5.4-mini",
      runtime: "openai",
      credentialMode: "byok",
      tenantId: "t1",
    });
    expect(mockDeduct.mock.calls[0][6]).toBe("byok");
  });

  it("en runtime openclaw imputa el target que devuelve la factoría", async () => {
    mockGetClient.mockResolvedValue({ client: openai, model: "openclaw/aa-a1", isOpenclaw: true });
    await inferLeadIntent({ ...PARAMS, runtime: "openclaw" });
    expect(mockCreate.mock.calls[0][0].model).toBe("openclaw/aa-a1");
    expect(mockDeduct.mock.calls[0][4]).toBe("openclaw/aa-a1");
  });
});

describe("inferLeadIntent — best-effort: nunca rompe el chat", () => {
  it("si el LLM falla, resuelve sin lanzar y no persiste nada", async () => {
    mockCreate.mockRejectedValue(new Error("429 quota"));
    await expect(inferLeadIntent(PARAMS)).resolves.toBeUndefined();
    expect(mockMergeMeta).not.toHaveBeenCalled();
  });

  it("si el metering falla, la etiqueta se persiste igual", async () => {
    mockDeduct.mockRejectedValue(new Error("sin cupo"));
    await expect(inferLeadIntent(PARAMS)).resolves.toBeUndefined();
    expect(mockMergeMeta).toHaveBeenCalledWith("conv-1", { leadIntent: "plan Pro" });
  });

  it("si la lectura de metadata falla, resuelve sin lanzar", async () => {
    mockGetMeta.mockRejectedValue(new Error("db caída"));
    await expect(inferLeadIntent(PARAMS)).resolves.toBeUndefined();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
