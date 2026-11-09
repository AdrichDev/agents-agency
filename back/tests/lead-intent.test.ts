// T8.6 (aa-agentes-economia-tokens) — derivación de `leadIntent` fuera del bucle agéntico.
//
// La tool `record_lead_intent` costaba una segunda llamada al LLM por cada mensaje con intención
// de compra, y su output era un eco de su propio argumento. Estas pruebas fijan el contrato del
// reemplazo: se paga una sola vez por conversación, sólo si hay lead, siempre se contabiliza, y
// nunca rompe el chat.

import { describe, it, expect, vi, beforeEach } from "vitest";

// S6 (responses-api-migration): el cliente doblado incluye `responses.create` porque los modelos
// marcados "solo Responses" en `model-capabilities.ts` (hoy gpt-5.6-luna) NO pueden pasar por
// chat.completions. Ningún test previo de este fichero usa esa ruta: el doble añadido no cambia
// lo que observan.
vi.mock("@/lib/openai", () => {
  const client = { chat: { completions: { create: vi.fn() } }, responses: { create: vi.fn() } };
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
const mockResponsesCreate = (openai as unknown as { responses: { create: ReturnType<typeof vi.fn> } })
  .responses.create;
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

  it("pide cero razonamiento y deja presupuesto para la respuesta", async () => {
    // El fallo que fija esta prueba se midió en producción: `governChatBody` inyecta el
    // `reasoning_effort` global (`low`) a todo body sin `tools`, y en un modelo razonador
    // `max_completion_tokens` INCLUYE los tokens de razonamiento. Con el tope en 32 el
    // razonamiento se lo comía entero: `finish_reason: "length"`, `content: ""`, 159 tokens
    // pagados por conversación y ninguna etiqueta guardada.
    await inferLeadIntent(PARAMS);
    const body = mockCreate.mock.calls[0][0];
    expect(body.reasoning_effort).toBe("none");
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(128);
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

// S6 (odd/tasks/responses-api-migration.md) — `gpt-5.6-luna` NO puede usar chat.completions:
// con herramientas la API rechaza la petición y sin ellas devolvió texto vacío con el tope de
// tokens comido por el razonamiento. La etiqueta se pide por la Responses API, que es la única
// ruta viva para ese modelo; el resto de modelos no cambia.
describe("inferLeadIntent — modelos solo-Responses (S6)", () => {
  const LUNA = { ...PARAMS, model: "gpt-5.6-luna" };

  function responsesText(text: string, tokens = 90) {
    return {
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
      usage: { total_tokens: tokens, input_tokens: 60, output_tokens: tokens - 60 },
    };
  }

  it("enruta por responses.create y persiste la etiqueta", async () => {
    mockResponsesCreate.mockResolvedValueOnce(responsesText("plan Pro"));

    await inferLeadIntent(LUNA);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    expect(mockMergeMeta).toHaveBeenCalledWith("conv-1", { leadIntent: "plan Pro" });
  });

  it("pide sin estado, sin herramientas y con el effort por defecto del catálogo", async () => {
    mockResponsesCreate.mockResolvedValueOnce(responsesText("plan Pro"));

    await inferLeadIntent(LUNA);

    const body = mockResponsesCreate.mock.calls[0][0];
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "low" },
      max_output_tokens: 256,
    });
    expect(body).not.toHaveProperty("tools");
    expect(body.input[0]).toMatchObject({ role: "system" });
    expect(body.input[1]).toMatchObject({ role: "user" });
    expect(body.input[1].content).toContain("Quiero el plan Pro");
  });

  it("contabiliza los tokens que informa la Responses API", async () => {
    mockResponsesCreate.mockResolvedValueOnce(responsesText("plan Pro", 90));

    await inferLeadIntent(LUNA);

    expect(mockDeduct).toHaveBeenCalledWith(
      "t1",
      "a1",
      "conv-1",
      90,
      "gpt-5.6-luna",
      "lead_intent",
      "platform"
    );
  });

  it("regresión: un modelo no marcado sigue por chat.completions con el mismo body", async () => {
    await inferLeadIntent(PARAMS);

    expect(mockResponsesCreate).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const body = mockCreate.mock.calls[0][0];
    expect(body).toMatchObject({ model: "gpt-5.4-mini", reasoning_effort: "none", max_completion_tokens: 256 });
  });

  it("un cliente sin responses.create falla cerrado: no cae a chat.completions", async () => {
    mockGetClient.mockResolvedValue({ client: { chat: { completions: { create: mockCreate } } }, isOpenclaw: false });

    await expect(inferLeadIntent(LUNA)).resolves.toBeUndefined();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockMergeMeta).not.toHaveBeenCalled();
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
