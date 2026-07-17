/**
 * T1.3 — aa-agente-consola-pruebas F1 (design.md §B.2, validation.md AC4).
 * La analítica que ve el cliente (`/api/stats`) excluye las conversaciones de
 * la consola de pruebas del operador (`isTest=true`).
 *
 * Mockea prisma — mismo patrón que tests/stats-aggregator.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { count: vi.fn(), findMany: vi.fn() },
    tenant: { count: vi.fn() },
    skill: { count: vi.fn(), groupBy: vi.fn() },
    lead: { count: vi.fn(), groupBy: vi.fn() },
    conversation: { count: vi.fn() },
    message: { count: vi.fn() },
    automation: { count: vi.fn() },
    budget: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import { fetchTotals, fetchTopAgents } from "@/lib/stats/queries";

const p = prisma as any;
const queryRawMock = p.$queryRaw as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of [p.agent.count, p.tenant.count, p.skill.count, p.lead.count, p.conversation.count, p.message.count, p.automation.count, p.budget.count]) {
    m.mockResolvedValue(0);
  }
  p.skill.groupBy.mockResolvedValue([]);
  p.lead.groupBy.mockResolvedValue([]);
  p.agent.findMany.mockResolvedValue([]);
  queryRawMock.mockResolvedValue([]);
});

describe("fetchTotals — conversationsCount excluye isTest=true", () => {
  it("llama a conversation.count con where: { isTest: false }", async () => {
    await fetchTotals();
    expect(p.conversation.count).toHaveBeenCalledWith({ where: { isTest: false } });
  });
});

describe("fetchTopAgents — raw SQL excluye isTest=true", () => {
  it("el WHERE de la query cruda filtra es_prueba = false", async () => {
    await fetchTopAgents();
    const [strings] = queryRawMock.mock.calls[0];
    const sqlText = Array.from(strings as TemplateStringsArray).join(" ");
    expect(sqlText).toMatch(/"es_prueba"\s*=\s*false/);
  });
});
