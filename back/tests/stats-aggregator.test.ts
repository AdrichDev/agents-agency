// Caracterización de getStats (stats/aggregator.ts) ANTES de encapsular el SQL.
// Fija el contrato observable de ambos paths (P7 sin params + filtrado) con datos
// vacíos: forma de la respuesta y nº de queries crudas emitidas. Mockea prisma.

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
import { getStats } from "@/lib/stats/aggregator";

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
  queryRawMock.mockResolvedValue([]); // toda query cruda devuelve vacío
});

describe("getStats — P7 (sin params)", () => {
  it("devuelve totales a cero, serie mensual de 12 puntos y billing de 12", async () => {
    const res = await getStats();

    expect(res.totals.agents).toBe(0);
    expect(res.totals.clients).toBe(0);
    expect(res.monthly).toHaveLength(12);
    expect(res.monthly[0]).toMatchObject({ agents: 0, leads: 0, conversations: 0, budgets: 0 });
    expect(res.billing.monthly).toHaveLength(12);
    expect(res.topAgents).toEqual([]);
  });

  it("emite 6 queries crudas (4 mensuales + billing + top agents) y NO findMany si no hay top", async () => {
    await getStats();
    expect(queryRawMock).toHaveBeenCalledTimes(6);
    expect(p.agent.findMany).not.toHaveBeenCalled();
  });

  it("trata {} igual que sin params (path P7)", async () => {
    const res = await getStats({});
    expect(res.monthly).toHaveLength(12);
    expect(queryRawMock).toHaveBeenCalledTimes(6);
  });
});

describe("getStats — path filtrado", () => {
  it("con datos vacíos: serie zero-fill (default last12m), topAgents vacío", async () => {
    const res = await getStats({ granularity: "month" });

    expect(res.totals.agents).toBe(0);
    // Sin range explícito el path filtrado usa last12m → serie continua zero-fill.
    expect(res.monthly.length).toBeGreaterThan(0);
    expect(res.monthly.every((m) => m.agents === 0 && m.leads === 0 && m.budgets === 0)).toBe(true);
    expect(res.billing.monthly.length).toBe(res.monthly.length);
    expect(res.topAgents).toEqual([]);
  });

  it("emite 6 queries crudas en el path filtrado", async () => {
    await getStats({ granularity: "month" });
    expect(queryRawMock).toHaveBeenCalledTimes(6);
  });

  it("resuelve nombres de top agents cuando hay filas", async () => {
    // top agents query (6ª) devuelve una fila; el resto vacías.
    queryRawMock.mockResolvedValue([]);
    queryRawMock.mockResolvedValueOnce([]); // leadMonths
    queryRawMock.mockResolvedValueOnce([]); // budgetMonths
    queryRawMock.mockResolvedValueOnce([]); // agentMonths
    queryRawMock.mockResolvedValueOnce([]); // convMonths
    queryRawMock.mockResolvedValueOnce([]); // billing
    queryRawMock.mockResolvedValueOnce([{ agentId: "ag-1", count: 3n }]); // topAgents
    p.agent.findMany.mockResolvedValue([{ id: "ag-1", name: "Bot Uno" }]);

    const res = await getStats({ granularity: "month" });

    expect(p.agent.findMany).toHaveBeenCalled();
    expect(res.topAgents[0]).toMatchObject({ agentId: "ag-1", agentName: "Bot Uno", conversations: 3 });
  });
});
