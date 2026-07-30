/**
 * H2 (aa-credenciales-byok-multiproveedor) — T4.2 / T5.3 / T5.4: el hilo completo.
 *
 * Los tests por capa comprueban cada pieza. Este comprueba que el modo VIAJA: se lee una vez en
 * el gate, llega al resolutor de cliente (para elegir con qué clave se sirve) y llega a
 * `deductTokens` (para decidir si se descuenta del cupo). Si se rompiera en medio, cada capa
 * seguiría verde por separado y el cliente BYOK se serviría con la clave de la plataforma o se
 * le descontaría un cupo que no le aplica.
 *
 * Y una fuga que no es de dinero pero sí de negocio: `credentialMode` NO puede salir en la
 * respuesta pública de `/api/chat`. Esa respuesta la recibe el visitante del widget alojado en
 * el sitio del cliente — revelaría el acuerdo comercial a cualquiera que abra el inspector.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.hoisted`: las factories de `vi.mock` se elevan al inicio del fichero, así que no pueden
// leer constantes declaradas después.
const { clientPlataforma, clientDelCliente } = vi.hoisted(() => ({
  clientPlataforma: { chat: { completions: { create: vi.fn() } } },
  clientDelCliente: { chat: { completions: { create: vi.fn() } } },
}));

vi.mock("@/lib/openai", () => ({
  openai: clientPlataforma,
  getClientForAgent: vi.fn(async () => ({ client: clientPlataforma, isOpenclaw: false })),
}));
vi.mock("@/lib/agent/executor", () => ({ executeTool: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ processNewLead: vi.fn() }));
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
    conversation: { create: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    message: { createMany: vi.fn() },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { getClientForAgent } from "@/lib/openai";
import { deductTokens } from "@/lib/token-metering";
import { chatWithAgent } from "@/lib/agent/engine";
import { HttpError } from "@/lib/http";

const mockGetClient = getClientForAgent as ReturnType<typeof vi.fn>;
const mockDeduct = deductTokens as ReturnType<typeof vi.fn>;
const mockAgent = prisma.agent.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockTenant = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;

function textCompletion(content: string, tokens = 30) {
  return { usage: { total_tokens: tokens }, choices: [{ message: { content, tool_calls: [] } }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAgent.mockResolvedValue({
    id: "a1",
    name: "Bot",
    model: "claude-opus-5",
    temperature: 0.5,
    systemPrompt: "Sé útil",
    ecommerceConfig: null,
    integrations: [],
    skills: [],
    tenantId: "tenant-byok",
    status: "published",
  });
  mockTenant.mockResolvedValue({
    isActive: true,
    tokenBalance: 1000,
    tokensUsed: 10, tokensUsedPeriod: 10, periodStart: new Date(), periodAnchorDay: 1,
    credentialMode: "byok",
  });
  (prisma.knowledgeChunk.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  (prisma.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (prisma.conversation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prisma.message.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prisma.conversation.create as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "conv-1",
    agentId: "a1",
    channel: "widget",
    metadata: {},
    messages: [],
  });
  mockGetClient.mockResolvedValue({ client: clientDelCliente, isOpenclaw: false });
  clientDelCliente.chat.completions.create.mockResolvedValue(textCompletion("Hola", 30));
});

describe("el modo viaja del gate al resolutor y al cobro", () => {
  it("byok: el resolutor recibe tenantId + modo, y el cobro recibe el modo", async () => {
    await chatWithAgent("a1", "hola", undefined, "widget");

    expect(mockGetClient).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "a1",
        tenantId: "tenant-byok",
        credentialMode: "byok",
        model: "claude-opus-5",
      })
    );
    expect(mockDeduct).toHaveBeenCalledWith(
      "tenant-byok",
      "a1",
      "conv-1",
      30,
      "claude-opus-5",
      undefined,
      "byok",
      expect.anything()
    );
  });

  it("se sirve con el cliente del CLIENTE, no con el de la plataforma", async () => {
    await chatWithAgent("a1", "hola", undefined, "widget");

    expect(clientDelCliente.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(clientPlataforma.chat.completions.create).not.toHaveBeenCalled();
  });

  it("platform: el mismo hilo transporta 'platform' (regresión de todo lo anterior a H2)", async () => {
    mockTenant.mockResolvedValue({
      isActive: true,
      tokenBalance: 1000,
      tokensUsed: 10, tokensUsedPeriod: 10, periodStart: new Date(), periodAnchorDay: 1,
      credentialMode: "platform",
    });
    mockGetClient.mockResolvedValue({ client: clientPlataforma, isOpenclaw: false });
    clientPlataforma.chat.completions.create.mockResolvedValue(textCompletion("Hola", 30));

    await chatWithAgent("a1", "hola", undefined, "widget");

    expect(mockGetClient).toHaveBeenCalledWith(
      expect.objectContaining({ credentialMode: "platform" })
    );
    expect(mockDeduct).toHaveBeenCalledWith(
      "tenant-byok",
      "a1",
      "conv-1",
      30,
      "claude-opus-5",
      undefined,
      "platform",
      expect.anything()
    );
  });

  it("con qué se SIRVE y con qué se COBRA salen de la misma lectura del gate", async () => {
    // Hay dos lecturas del tenant a propósito: el gate temprano de H1/H3 corta antes de crear
    // la Conversation, y `runAgent` vuelve a pasar por el gate. La invariante no es "una sola
    // lectura" — es que el modo que elige la clave y el modo que decide el cobro sean el MISMO.
    // Aquí se fuerza la discrepancia: la primera lectura dice platform, la segunda byok.
    mockTenant
      .mockResolvedValueOnce({
        isActive: true,
        tokenBalance: 1000,
        tokensUsed: 10, tokensUsedPeriod: 10, periodStart: new Date(), periodAnchorDay: 1,
        credentialMode: "platform",
      })
      .mockResolvedValueOnce({
        isActive: true,
        tokenBalance: 1000,
        tokensUsed: 10, tokensUsedPeriod: 10, periodStart: new Date(), periodAnchorDay: 1,
        credentialMode: "byok",
      });

    await chatWithAgent("a1", "hola", undefined, "widget");

    const modoServido = mockGetClient.mock.calls[0][0].credentialMode;
    const modoCobrado = mockDeduct.mock.calls[0][6];
    expect(modoServido).toBe(modoCobrado);
    // Y es el de la lectura que autorizó la llamada realmente servida (la de `runAgent`).
    expect(modoServido).toBe("byok");
  });
});

describe("fail-closed del resolutor a través del motor", () => {
  it("el 402 por credencial ausente sale del motor sin cobrar nada", async () => {
    mockGetClient.mockRejectedValue(
      new HttpError(402, "No hay una clave de OpenAI configurada. Contacta con el administrador.")
    );

    await expect(chatWithAgent("a1", "hola", undefined, "widget")).rejects.toMatchObject({
      status: 402,
    });

    expect(mockDeduct).not.toHaveBeenCalled();
    expect(clientPlataforma.chat.completions.create).not.toHaveBeenCalled();
  });
});

describe("T5.4 — el modo no se filtra a la respuesta pública", () => {
  it("credentialMode y meteredTenantId no salen en la respuesta de chatWithAgent", async () => {
    const reply = await chatWithAgent("a1", "hola", undefined, "widget");

    // Esta respuesta la recibe el visitante del widget en el sitio del cliente.
    expect(reply).not.toHaveProperty("credentialMode");
    expect(reply).not.toHaveProperty("meteredTenantId");
    expect(JSON.stringify(reply)).not.toContain("byok");
    // Y sigue llevando lo que el widget necesita.
    expect(reply.text).toBe("Hola");
  });
});
