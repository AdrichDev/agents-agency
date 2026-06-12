import { describe, it, expect } from "vitest";
import { statsQuerySchema, GRANULARITY_MAP } from "@/lib/stats";

// Tests for schema validation and whitelist map.
// DB-dependent aggregation is covered by integration tests.

describe("statsQuerySchema", () => {
  it("accepts no params (P7 regression path)", () => {
    const result = statsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid granularity values", () => {
    for (const g of ["year", "month", "week"] as const) {
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
  it("has no other keys (exhaustive whitelist)", () => {
    const keys = Object.keys(GRANULARITY_MAP);
    expect(keys).toHaveLength(3);
    expect(keys).toEqual(expect.arrayContaining(["year", "month", "week"]));
  });
});
