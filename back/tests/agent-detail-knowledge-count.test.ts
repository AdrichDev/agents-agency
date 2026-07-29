/**
 * T1.4 — aa-agente-consola-pruebas F1 (design.md §B.3).
 * `getAgentDetail` (consumido por la ficha del agente, GET /api/agents/:id) ya
 * expone el nº de fragmentos de conocimiento indexados vía `_count.knowledge`
 * (mismo conteo que engine.ts:553 `prisma.knowledgeChunk.count`). Este test fija
 * ese contrato para que el front de la consola pueda pintar el banner de estado
 * (AC3) sin una query adicional.
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

const mockFindUnique = prisma.agent.findUnique as ReturnType<typeof vi.fn>;

function agentRow(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    name: "Bot",
    ecommerceConfig: {},
    tenant: null,
    integrations: [],
    skills: [],
    automations: [],
    dataBackend: null,
    _count: { knowledge: 12, conversations: 3, leads: 1 },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAgentDetail — estado del agente para el banner (T1.4)", () => {
  it("expone _count.knowledge con el nº de fragmentos indexados", async () => {
    mockFindUnique.mockResolvedValue(agentRow());

    const detail = await getAgentDetail("a1");

    expect(detail._count.knowledge).toBe(12);
  });

  it("con 0 fragmentos, expone _count.knowledge = 0 (banner 'aún sin conocimiento')", async () => {
    mockFindUnique.mockResolvedValue(agentRow({ _count: { knowledge: 0, conversations: 0, leads: 0 } }));

    const detail = await getAgentDetail("a1");

    expect(detail._count.knowledge).toBe(0);
  });

  it("404 si el agente no existe", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(getAgentDetail("nope")).rejects.toMatchObject({ status: 404 });
  });
});
