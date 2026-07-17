/**
 * Fix AC4 (aa-agente-consola-pruebas, sdd-verify CRITICAL) — el contador
 * "💬 N chats" que ve el cliente en la tarjeta de agente (listAgents) y en la
 * ficha del agente (getAgentDetail) NO debe inflarse con conversaciones de la
 * consola de pruebas del operador (Conversation.isTest = true).
 *
 * Prisma 7 soporta filtered relation count vía `_count.select.<rel>.where`.
 * Este test fija el contrato de query (mock de prisma) y, con datos, que el
 * conteo devuelto excluye isTest:true.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/n8n/client", () => ({ isConfigured: vi.fn(() => false) }));

import { prisma } from "@/lib/db";
import { listAgents, getAgentDetail } from "@/lib/agent/service";

const mockFindMany = prisma.agent.findMany as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.agent.findUnique as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAgents — conteo de conversaciones excluye isTest (fix AC4)", () => {
  it("pide a Prisma el conteo de conversations filtrado por isTest:false", async () => {
    mockFindMany.mockResolvedValue([]);

    await listAgents();

    const args = mockFindMany.mock.calls[0][0];
    expect(args.include._count.select.conversations).toEqual({ where: { isTest: false } });
  });

  it("devuelve solo el nº de conversaciones reales (no de prueba)", async () => {
    // Simula lo que Prisma devolvería ya filtrado por el where del _count:
    // 5 reales + 3 de prueba en BD → Prisma cuenta 5.
    mockFindMany.mockResolvedValue([
      {
        id: "a1",
        ecommerceConfig: {},
        tenant: null,
        integrations: [],
        _count: { conversations: 5, automations: 0, knowledge: 0, leads: 0 },
      },
    ]);

    const agents = await listAgents();

    expect(agents[0]._count.conversations).toBe(5);
  });
});

describe("getAgentDetail — conteo de conversaciones excluye isTest (fix AC4)", () => {
  it("pide a Prisma el conteo de conversations filtrado por isTest:false", async () => {
    mockFindUnique.mockResolvedValue({
      id: "a1",
      name: "Bot",
      ecommerceConfig: {},
      tenant: null,
      integrations: [],
      skills: [],
      automations: [],
      dataBackend: null,
      _count: { knowledge: 0, conversations: 0, leads: 0 },
    });

    await getAgentDetail("a1");

    const args = mockFindUnique.mock.calls[0][0];
    expect(args.include._count.select.conversations).toEqual({ where: { isTest: false } });
  });

  it("devuelve solo el nº de conversaciones reales (no de prueba)", async () => {
    mockFindUnique.mockResolvedValue({
      id: "a1",
      name: "Bot",
      ecommerceConfig: {},
      tenant: null,
      integrations: [],
      skills: [],
      automations: [],
      dataBackend: null,
      _count: { knowledge: 0, conversations: 7, leads: 0 },
    });

    const detail = await getAgentDetail("a1");

    expect(detail._count.conversations).toBe(7);
  });
});
