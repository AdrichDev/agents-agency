/**
 * H3 (aa-agente-ciclo-vida-publicacion, T5.1) — `getAgentDetail` expone las precondiciones
 * de publicación.
 *
 * Por qué se calculan en el back y no en el front: el panel de entrega tiene que decir QUÉ
 * falta antes de que nadie pulse "Publicar", y la regla que decide el 400 de
 * `POST /:id/publish` ya vive en `checkPublishPreconditions`. Reimplementarla en TypeScript
 * del front sería tener dos copias de una misma regla, y dos copias acaban discrepando: la
 * interfaz diría "puedes publicar" y el back lo rechazaría. Este test fija que el contrato
 * sale del detalle, con la misma función.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn() },
    // aa-puesta-en-marcha-agente (T2): `getAgentDetail`/`listAgents` calculan el
    // escalón de puesta en marcha y para eso consultan la última conversación
    // no-test. Sólo se amplía el mock; ninguna aserción cambia.
    conversation: { findFirst: vi.fn(async () => null), groupBy: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/n8n/client", () => ({ isConfigured: vi.fn(() => false) }));

import { prisma } from "@/lib/db";
import { getAgentDetail } from "@/lib/agent/service";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** Agente publicable: tiene cliente al que cobrar y prompt, y su canal es el widget. */
function agentRow(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    name: "Bot",
    status: "draft",
    tenantId: "tenant-1",
    systemPrompt: "Eres el asistente de la Clínica Norte.",
    channel: "widget",
    channelConnections: [],
    ecommerceConfig: {},
    tenant: null,
    integrations: [],
    skills: [],
    automations: [],
    dataBackend: null,
    _count: { knowledge: 0, conversations: 0, leads: 0 },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAgentDetail — publishPreconditions (T5.1)", () => {
  it("agente completo ⇒ sin bloqueantes y sin avisos", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(agentRow());

    const detail = await getAgentDetail("a1");

    expect(detail.publishPreconditions).toEqual({ blocking: [], warnings: [] });
  });

  it("sin tenant y sin prompt ⇒ los DOS bloqueantes, enumerados", async () => {
    // Enumerar, no resumir en "faltan datos": un mensaje genérico obliga a adivinar cuál.
    asMock(prisma.agent.findUnique).mockResolvedValue(
      agentRow({ tenantId: null, systemPrompt: "   " })
    );

    const { blocking } = (await getAgentDetail("a1")).publishPreconditions;

    expect(blocking).toHaveLength(2);
    expect(blocking.join(" ")).toMatch(/cliente/i);
    expect(blocking.join(" ")).toMatch(/prompt/i);
  });

  it("canal whatsapp sin conexión ⇒ aviso, NO bloqueante", async () => {
    // T0.1b lo tumbó con datos: 3 de los 6 agentes que servían tráfico en producción tienen
    // `channel = "whatsapp"` sin conexión y atienden por widget. Bloquear habría rechazado
    // la mitad de los agentes vendidos.
    asMock(prisma.agent.findUnique).mockResolvedValue(
      agentRow({ channel: "whatsapp", channelConnections: [] })
    );

    const { blocking, warnings } = (await getAgentDetail("a1")).publishPreconditions;

    expect(blocking).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/whatsapp/i);
  });

  it("canal whatsapp CON conexión ⇒ ni bloqueante ni aviso", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(
      agentRow({ channel: "whatsapp", channelConnections: [{ provider: "whatsapp" }] })
    );

    expect((await getAgentDetail("a1")).publishPreconditions).toEqual({
      blocking: [],
      warnings: [],
    });
  });

  it("la query pide channelConnections: sin ese select el aviso sería siempre falso", async () => {
    // Guardián del guardián. Si alguien quita el `include`, Prisma no devolvería las
    // conexiones y el panel diría "no conectado" de un canal que sí lo está — o reventaría.
    asMock(prisma.agent.findUnique).mockResolvedValue(agentRow());

    await getAgentDetail("a1");

    const { include } = asMock(prisma.agent.findUnique).mock.calls[0][0];
    // aa-puesta-en-marcha-agente (T2.2) añade `status` al select: el escalón
    // "alcanzable" necesita saber si la conexión está activa, no sólo que
    // existe. Lo que este test defiende sigue intacto — que el `include` esté —
    // y se refuerza: `credentials` y `webhookSecret` NO pueden colarse aquí.
    expect(include.channelConnections).toEqual({ select: { provider: true, status: true } });
  });
});
