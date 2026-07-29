/**
 * T2.4 (aa-puesta-en-marcha-agente) — el contrato de puesta en marcha sale por
 * las DOS superficies y con el MISMO criterio.
 *
 * AC1 es lo que este test defiende: si `listAgents` y `getAgentDetail` calculan
 * el escalón por su cuenta, acaban discrepando y la lista dice una cosa y la
 * ficha otra. Aquí se alimentan ambas con la misma fila y se exige igualdad.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findMany: vi.fn(), findUnique: vi.fn() },
    conversation: { findFirst: vi.fn(async () => null), groupBy: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/n8n/client", () => ({ isConfigured: vi.fn(() => false) }));

import { prisma } from "@/lib/db";
import { listAgents, getAgentDetail } from "@/lib/agent/service";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const PUBLISHED_AT = new Date("2026-07-27T18:47:00Z");
const TRAFFIC_AT = new Date("2026-07-27T20:31:00Z");

function agentRow(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    name: "AiAs",
    status: "published",
    publishedAt: PUBLISHED_AT,
    tenantId: "tenant-1",
    systemPrompt: "Eres el asistente del estudio.",
    channel: "widget",
    widgetInstalledAt: new Date("2026-07-27T18:49:00Z"),
    channelConnections: [],
    ecommerceConfig: {},
    tenant: null,
    integrations: [],
    skills: [],
    automations: [],
    dataBackend: null,
    _count: { knowledge: 0, conversations: 3, leads: 0, automations: 0 },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.conversation.findFirst).mockResolvedValue(null);
  asMock(prisma.conversation.groupBy).mockResolvedValue([]);
});

describe("AC1 — un solo criterio para las dos superficies", () => {
  it("listado y detalle devuelven el mismo `onboarding` para la misma fila", async () => {
    const row = agentRow();
    asMock(prisma.agent.findMany).mockResolvedValue([row]);
    asMock(prisma.agent.findUnique).mockResolvedValue(row);
    asMock(prisma.conversation.groupBy).mockResolvedValue([
      { agentId: "a1", _max: { createdAt: TRAFFIC_AT } },
    ]);
    asMock(prisma.conversation.findFirst).mockResolvedValue({ createdAt: TRAFFIC_AT });

    const [fromList] = await listAgents();
    const detail = await getAgentDetail("a1");

    expect(fromList.onboarding).toEqual(detail.onboarding);
    expect(detail.onboarding.step).toBe("probado");
  });

  it("un borrador sale como `configurado` por las dos vías", async () => {
    const row = agentRow({ status: "draft", publishedAt: null });
    asMock(prisma.agent.findMany).mockResolvedValue([row]);
    asMock(prisma.agent.findUnique).mockResolvedValue(row);

    const [fromList] = await listAgents();
    const detail = await getAgentDetail("a1");

    expect(fromList.onboarding).toEqual(detail.onboarding);
    expect(detail.onboarding.step).toBe("configurado");
    expect(detail.onboarding.alcanzable).toBe(false);
  });
});

describe("listAgents — el agregado de tráfico", () => {
  it("GWT9 — cuenta los que no atienden a nadie, sin recalcular el criterio", async () => {
    asMock(prisma.agent.findMany).mockResolvedValue([
      agentRow({ id: "probado" }),
      agentRow({ id: "sin-alcance", widgetInstalledAt: null, channelConnections: [] }),
      agentRow({ id: "borrador", status: "draft", publishedAt: null }),
    ]);
    asMock(prisma.conversation.groupBy).mockResolvedValue([
      { agentId: "probado", _max: { createdAt: TRAFFIC_AT } },
    ]);

    const agents = await listAgents();
    const sinAtender = agents.filter((a) => !a.onboarding.alcanzable);

    expect(sinAtender.map((a) => a.id)).toEqual(["sin-alcance", "borrador"]);
    expect(sinAtender).toHaveLength(2);
  });

  it("una SOLA consulta agregada para todo el listado, no una por agente", async () => {
    // El coste de esta ruta no puede crecer con el número de agentes: si esto se
    // convierte en un findFirst por fila, el listado se degrada en silencio.
    asMock(prisma.agent.findMany).mockResolvedValue([
      agentRow({ id: "a1" }),
      agentRow({ id: "a2" }),
      agentRow({ id: "a3" }),
    ]);

    await listAgents();

    expect(asMock(prisma.conversation.groupBy)).toHaveBeenCalledTimes(1);
    expect(asMock(prisma.conversation.findFirst)).not.toHaveBeenCalled();

    const arg = asMock(prisma.conversation.groupBy).mock.calls[0][0];
    expect(arg.where.isTest).toBe(false);
    expect(arg.where.agentId).toEqual({ in: ["a1", "a2", "a3"] });
  });

  it("con cero agentes no lanza la consulta agregada ni revienta", async () => {
    asMock(prisma.agent.findMany).mockResolvedValue([]);

    await expect(listAgents()).resolves.toEqual([]);
    expect(asMock(prisma.conversation.groupBy)).not.toHaveBeenCalled();
  });

  it("un agente sin ninguna conversación no queda como probado", async () => {
    asMock(prisma.agent.findMany).mockResolvedValue([agentRow()]);
    asMock(prisma.conversation.groupBy).mockResolvedValue([]);

    const [a] = await listAgents();

    expect(a.onboarding.alcanzable).toBe(true);
    expect(a.onboarding.probado).toBe(false);
  });
});

describe("no se filtran secretos de canal", () => {
  it("el listado pide de `channelConnections` sólo `provider` y `status`", async () => {
    asMock(prisma.agent.findMany).mockResolvedValue([]);

    await listAgents();

    const { include } = asMock(prisma.agent.findMany).mock.calls[0][0];
    // `credentials` es ciphertext AES-256-GCM y `webhookSecret` es un secreto de
    // Telegram: ninguno de los dos puede aparecer en una respuesta de listado.
    expect(include.channelConnections).toEqual({ select: { provider: true, status: true } });
  });
});
