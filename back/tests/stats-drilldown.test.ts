import { describe, it, expect, beforeEach, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  budget: { findMany: vi.fn() },
  lead: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { getDrilldown } from "@/lib/stats/drilldown";

/** Devuelve el `where` con el que se llamó a budget/lead.findMany. */
function whereOf(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls[0][0].where;
}
const utc = (y: number, m: number, d: number) => Date.UTC(y, m, d);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.budget.findMany.mockResolvedValue([]);
  prismaMock.lead.findMany.mockResolvedValue([]);
});

describe("getDrilldown — parseo de período → rango UTC [gte, lte]", () => {
  it("día YYYY-MM-DD acota a las 24h de ese día", async () => {
    await getDrilldown("2026-09-03");
    const r = whereOf(prismaMock.budget.findMany).createdAt;
    expect(r.gte.getTime()).toBe(utc(2026, 8, 3));
    expect(r.lte.getTime()).toBe(utc(2026, 8, 4) - 1);
  });

  it("mes YYYY-MM acota al mes completo (febrero)", async () => {
    await getDrilldown("2026-02");
    const r = whereOf(prismaMock.budget.findMany).createdAt;
    expect(r.gte.getTime()).toBe(utc(2026, 1, 1));
    expect(r.lte.getTime()).toBe(utc(2026, 2, 1) - 1);
  });

  it("año YYYY acota al año completo", async () => {
    await getDrilldown("2026");
    const r = whereOf(prismaMock.budget.findMany).createdAt;
    expect(r.gte.getTime()).toBe(utc(2026, 0, 1));
    expect(r.lte.getTime()).toBe(utc(2027, 0, 1) - 1);
  });

  it("semana ISO YYYY-Www arranca el lunes (2026-W01 → lun 2025-12-29)", async () => {
    await getDrilldown("2026-W01");
    const r = whereOf(prismaMock.budget.findMany).createdAt;
    expect(r.gte.getTime()).toBe(utc(2025, 11, 29));
    expect(r.lte.getTime()).toBe(utc(2025, 11, 29) + 7 * 86400000 - 1);
  });
});

describe("getDrilldown — construcción de filtros (where)", () => {
  it("aplica clientId, status y serviceId (vía lines.some) a budgets", async () => {
    await getDrilldown("2026-02", { clientId: "cl1", status: "aceptada", serviceId: "svc1" } as any);
    const w = whereOf(prismaMock.budget.findMany);
    expect(w.clientId).toBe("cl1");
    expect(w.status).toBe("aceptada");
    expect(w.lines).toEqual({ some: { serviceId: "svc1" } });
  });

  it("sector se mapea a client.sector", async () => {
    await getDrilldown("2026", { sector: "tech" } as any);
    expect(whereOf(prismaMock.budget.findMany).client).toEqual({ sector: "tech" });
  });

  it("agentId filtra leads, no budgets", async () => {
    await getDrilldown("2026", { agentId: "ag1" } as any);
    expect(whereOf(prismaMock.lead.findMany).agentId).toBe("ag1");
    expect(whereOf(prismaMock.budget.findMany).clientId).toBeUndefined();
  });
});

describe("getDrilldown — forma de la respuesta", () => {
  it("mapea budgets y leads con createdAt ISO y clientName fallback", async () => {
    prismaMock.budget.findMany.mockResolvedValue([
      {
        id: "b1", quoteNumber: "AD-2026-001", client: { name: "Ana" },
        totalImpl: 100, totalMaint: 10, status: "generada",
        createdAt: new Date("2026-02-10T00:00:00.000Z"),
      },
      {
        id: "b2", quoteNumber: "AD-2026-002", client: null,
        totalImpl: 0, totalMaint: 0, status: "rechazada",
        createdAt: new Date("2026-02-11T00:00:00.000Z"),
      },
    ]);
    prismaMock.lead.findMany.mockResolvedValue([
      { id: "l1", customerName: "Bob", status: "new", createdAt: new Date("2026-02-12T00:00:00.000Z") },
    ]);

    const res = await getDrilldown("2026-02");
    expect(res.period).toBe("2026-02");
    expect(res.budgets[0]).toEqual({
      id: "b1", quoteNumber: "AD-2026-001", clientName: "Ana",
      totalImpl: 100, totalMaint: 10, status: "generada",
      createdAt: "2026-02-10T00:00:00.000Z",
    });
    expect(res.budgets[1].clientName).toBeNull();
    expect(res.leads[0]).toEqual({
      id: "l1", customerName: "Bob", status: "new", createdAt: "2026-02-12T00:00:00.000Z",
    });
  });
});
