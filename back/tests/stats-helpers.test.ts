import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  toYYYYMM,
  periodKey,
  twelveMonthsAgo,
  rangeStart,
  rangeEnd,
  round2,
  dateFragment,
  toCountMap,
  buildTotals,
  accumulateBilling,
  mapTopAgents,
} from "@/lib/stats/helpers";

/**
 * Cubre los helpers de fecha/agregación de stats que stats.test.ts no toca:
 * isoWeek en frontera de año (vía periodKey), padding YYYY-MM/YYYY-MM-DD,
 * rangeStart/rangeEnd/twelveMonthsAgo (con reloj congelado) y dateFragment.
 */

describe("stats helpers — formato de periodKey y padding", () => {
  it("toYYYYMM aplica padding de mes (UTC)", () => {
    expect(toYYYYMM(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-01");
    expect(toYYYYMM(new Date(Date.UTC(2026, 11, 31)))).toBe("2026-12");
  });

  it("periodKey day aplica padding de mes y día", () => {
    expect(periodKey(new Date(Date.UTC(2026, 8, 3)), "day")).toBe("2026-09-03");
  });

  it("periodKey week: ISO week en frontera de año (lunes 2025-12-29 → 2026-W01)", () => {
    // La semana ISO que contiene el jueves 2026-01-01 es la W01 de 2026.
    expect(periodKey(new Date(Date.UTC(2025, 11, 29)), "week")).toBe("2026-W01");
    expect(periodKey(new Date(Date.UTC(2026, 0, 1)), "week")).toBe("2026-W01");
  });

  it("periodKey year", () => {
    expect(periodKey(new Date(Date.UTC(2026, 5, 17)), "year")).toBe("2026");
  });
});

describe("stats helpers — rangos dependientes de fecha (reloj congelado)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T12:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("twelveMonthsAgo: primer día del mes, 11 meses atrás, UTC (jul-2025)", () => {
    const d = twelveMonthsAgo();
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(6); // julio (0-indexed)
    expect(d.getUTCDate()).toBe(1);
  });

  it("rangeStart last12m == twelveMonthsAgo", () => {
    const d = rangeStart({ range: "last12m" } as any)!;
    expect(d.toISOString()).toBe(twelveMonthsAgo().toISOString());
  });

  it("rangeStart ytd == 1 de enero del año en curso (UTC)", () => {
    const d = rangeStart({ range: "ytd" } as any)!;
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(1);
  });

  it("rangeStart all == null", () => {
    expect(rangeStart({ range: "all" } as any)).toBeNull();
  });

  it("rangeStart custom usa query.from", () => {
    const d = rangeStart({ range: "custom", from: "2026-03-15" } as any)!;
    expect(d.toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it("rangeStart sin range hace fallback a last12m", () => {
    const d = rangeStart({} as any)!;
    expect(d.toISOString()).toBe(twelveMonthsAgo().toISOString());
  });

  it("rangeEnd: custom con to devuelve esa fecha; resto null", () => {
    const d = rangeEnd({ range: "custom", to: "2026-04-20" } as any)!;
    expect(d.toISOString().slice(0, 10)).toBe("2026-04-20");
    expect(rangeEnd({ range: "last12m" } as any)).toBeNull();
    expect(rangeEnd({ range: "custom" } as any)).toBeNull();
  });
});

describe("stats helpers — round2", () => {
  it("elimina ruido IEEE-754", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(10 / 3)).toBe(3.33);
    expect(round2(2.5)).toBe(2.5);
    expect(round2(0)).toBe(0);
  });
});

describe("stats helpers — reducers (toCountMap/buildTotals/accumulateBilling/mapTopAgents)", () => {
  it("toCountMap indexa por la clave derivada y coacciona count (bigint→number)", () => {
    const m = toCountMap(
      [
        { month: new Date(Date.UTC(2026, 0, 1)), count: 5n as any },
        { month: new Date(Date.UTC(2026, 1, 1)), count: 3n as any },
      ],
      toYYYYMM
    );
    expect(m.get("2026-01")).toBe(5);
    expect(m.get("2026-02")).toBe(3);
    expect(m.size).toBe(2);
  });

  it("buildTotals ensambla skillsByType[] y leadsByStatus{}", () => {
    const t = buildTotals({
      agents: 2, clients: 4, skills: 3,
      skillsByType: [{ type: "calendar", _count: { _all: 2 } }, { type: "rag", _count: { _all: 1 } }],
      leads: 7,
      leadsByStatus: [{ status: "new", _count: { _all: 5 } }, { status: "handoff", _count: { _all: 2 } }],
      conversations: 9, messages: 20, automations: 1, budgets: 6,
    });
    expect(t.agents).toBe(2);
    expect(t.skillsByType).toEqual([{ type: "calendar", count: 2 }, { type: "rag", count: 1 }]);
    expect(t.leadsByStatus).toEqual({ new: 5, handoff: 2 });
    expect(t.budgets).toBe(6);
  });

  it("accumulateBilling agrupa por periodo+status y redondea (round2)", () => {
    const { monthMap, totals } = accumulateBilling(
      [
        { month: new Date(Date.UTC(2026, 0, 5)), status: "accepted", total: 100.005 },
        { month: new Date(Date.UTC(2026, 0, 20)), status: "draft", total: 50 },
        { month: new Date(Date.UTC(2026, 1, 2)), status: "accepted", total: 10 },
      ],
      toYYYYMM
    );
    const jan = monthMap.get("2026-01")!;
    expect(jan.accepted).toBe(100.01); // round2(100.005)
    expect(jan.draft).toBe(50);
    expect(jan.total).toBe(150.01);
    expect(monthMap.get("2026-02")!.accepted).toBe(10);
    expect(totals.total).toBe(160.01);
    expect(totals.accepted).toBe(110.01);
    expect(totals.draft).toBe(50);
  });

  it("accumulateBilling: status desconocido suma a total pero no a ningún bucket", () => {
    const { monthMap, totals } = accumulateBilling(
      [{ month: new Date(Date.UTC(2026, 0, 1)), status: "caducada", total: 30 }],
      toYYYYMM
    );
    const jan = monthMap.get("2026-01")!;
    expect(jan.total).toBe(30);
    expect(jan.draft + jan.sent + jan.accepted + jan.rejected).toBe(0);
    expect(totals.total).toBe(30);
  });

  it("mapTopAgents resuelve nombre, con fallback al id", () => {
    const out = mapTopAgents(
      [{ agentId: "a1", count: 12n as any }, { agentId: "a2", count: 4n as any }],
      new Map([["a1", "Soporte"]])
    );
    expect(out).toEqual([
      { agentId: "a1", agentName: "Soporte", conversations: 12 },
      { agentId: "a2", agentName: "a2", conversations: 4 },
    ]);
  });
});

describe("stats helpers — dateFragment", () => {
  it("sin fechas → fragmento vacío (sin valores)", () => {
    expect(dateFragment("createdAt", null, null).values).toHaveLength(0);
  });

  it("ambos límites → 2 valores", () => {
    const f = dateFragment("createdAt", new Date("2026-01-01"), new Date("2026-06-01"));
    expect(f.values).toHaveLength(2);
  });

  it("un solo límite → 1 valor", () => {
    expect(dateFragment("createdAt", new Date("2026-01-01"), null).values).toHaveLength(1);
    expect(dateFragment("createdAt", null, new Date("2026-06-01")).values).toHaveLength(1);
  });
});
