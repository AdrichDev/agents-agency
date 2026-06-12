import { describe, it, expect } from "vitest";
import { statsQuerySchema, GRANULARITY_MAP, periodKey, enumeratePeriods } from "@/lib/stats";

// Tests for schema validation, whitelist map and pure period helpers.
// DB-dependent aggregation is covered by integration tests.

describe("statsQuerySchema", () => {
  it("accepts no params (P7 regression path)", () => {
    const result = statsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid granularity values", () => {
    for (const g of ["year", "month", "week", "day"] as const) {
      expect(statsQuerySchema.safeParse({ granularity: g }).success).toBe(true);
    }
  });

  it("rejects invalid granularity", () => {
    const result = statsQuerySchema.safeParse({ granularity: "daily" });
    expect(result.success).toBe(false);
  });

  it("rejects range=custom without from/to", () => {
    const result = statsQuerySchema.safeParse({ range: "custom" });
    expect(result.success).toBe(false);
  });

  it("rejects range=custom with only from", () => {
    const result = statsQuerySchema.safeParse({ range: "custom", from: "2026-01-01" });
    expect(result.success).toBe(false);
  });

  it("accepts range=custom with both from and to", () => {
    const result = statsQuerySchema.safeParse({ range: "custom", from: "2026-01-01", to: "2026-03-31" });
    expect(result.success).toBe(true);
  });

  it("accepts all valid range values", () => {
    for (const range of ["last12m", "ytd", "all"] as const) {
      expect(statsQuerySchema.safeParse({ range }).success).toBe(true);
    }
  });

  it("accepts single-month drilldown query (granularity=day + custom range)", () => {
    const result = statsQuerySchema.safeParse({
      granularity: "day",
      range: "custom",
      from: "2026-06-01",
      to: "2026-06-30",
    });
    expect(result.success).toBe(true);
  });

  it("accepts combined filters", () => {
    const result = statsQuerySchema.safeParse({
      granularity: "month",
      range: "ytd",
      clientId: "abc123",
      serviceId: "chatbot_pro",
      revenueType: "maint",
      sector: "retail",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid revenueType", () => {
    const result = statsQuerySchema.safeParse({ revenueType: "other" });
    expect(result.success).toBe(false);
  });
});

describe("GRANULARITY_MAP whitelist", () => {
  it("maps year → year", () => {
    expect(GRANULARITY_MAP.year).toBe("year");
  });
  it("maps month → month", () => {
    expect(GRANULARITY_MAP.month).toBe("month");
  });
  it("maps week → week", () => {
    expect(GRANULARITY_MAP.week).toBe("week");
  });
  it("maps day → day", () => {
    expect(GRANULARITY_MAP.day).toBe("day");
  });
  // "day" was added deliberately for the single-month drilldown view
  // (X axis with one point per day). Whitelist stays exhaustive.
  it("has no other keys (exhaustive whitelist)", () => {
    const keys = Object.keys(GRANULARITY_MAP);
    expect(keys).toHaveLength(4);
    expect(keys).toEqual(expect.arrayContaining(["year", "month", "week", "day"]));
  });
});

describe("periodKey", () => {
  const d = new Date(Date.UTC(2026, 5, 3)); // 2026-06-03 (Wednesday)

  it("formats year keys", () => {
    expect(periodKey(d, "year")).toBe("2026");
  });
  it("formats month keys", () => {
    expect(periodKey(d, "month")).toBe("2026-06");
  });
  it("formats day keys with zero padding", () => {
    expect(periodKey(d, "day")).toBe("2026-06-03");
  });
  it("formats ISO week keys", () => {
    expect(periodKey(d, "week")).toBe("2026-W23");
  });
});

describe("enumeratePeriods (shape guarantee — continuous series, no gaps)", () => {
  it("fills every month of a range, including empty ones", () => {
    const keys = enumeratePeriods(
      new Date(Date.UTC(2025, 10, 15)),
      new Date(Date.UTC(2026, 1, 1)),
      "month"
    );
    expect(keys).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("fills every day of a month (single-month drilldown)", () => {
    const keys = enumeratePeriods(
      new Date(Date.UTC(2026, 5, 1)),
      new Date(Date.UTC(2026, 6, 1) - 1),
      "day"
    );
    expect(keys).toHaveLength(30);
    expect(keys[0]).toBe("2026-06-01");
    expect(keys[29]).toBe("2026-06-30");
  });

  it("fills years", () => {
    const keys = enumeratePeriods(
      new Date(Date.UTC(2024, 3, 1)),
      new Date(Date.UTC(2026, 0, 1)),
      "year"
    );
    expect(keys).toEqual(["2024", "2025", "2026"]);
  });

  it("fills ISO weeks aligned to Monday", () => {
    const keys = enumeratePeriods(
      new Date(Date.UTC(2026, 0, 7)),
      new Date(Date.UTC(2026, 0, 28)),
      "week"
    );
    expect(keys).toEqual(["2026-W02", "2026-W03", "2026-W04", "2026-W05"]);
  });

  it("returns empty when start is after end", () => {
    const keys = enumeratePeriods(
      new Date(Date.UTC(2026, 5, 1)),
      new Date(Date.UTC(2026, 0, 1)),
      "day"
    );
    expect(keys).toEqual([]);
  });

  it("bails out (empty) instead of producing huge day fills", () => {
    const keys = enumeratePeriods(
      new Date(Date.UTC(2020, 0, 1)),
      new Date(Date.UTC(2026, 0, 1)),
      "day"
    );
    expect(keys).toEqual([]);
  });
});
