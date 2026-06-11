import { describe, expect, it } from "vitest";
import { normalizeSectorName, paginateSectors } from "@/lib/sectors";

describe("sectors service", () => {
  it("normalizes sector names with capitalized first letter", () => {
    expect(normalizeSectorName("  salud dental  ")).toBe("Salud dental");
  });

  it("paginates alphabetically with Otro always present", () => {
    const result = paginateSectors(
      ["Zeta", "Legal", "Educacion", "Salud", "Retail", "SaaS", "Automocion", "Belleza", "Consultoria", "Dental"],
      { page: 1, pageSize: 9 }
    );

    expect(result.items).toHaveLength(9);
    expect(result.items).toContain("Otro");
    expect(result.totalPages).toBe(2);
    expect(result.items.filter((item) => item !== "Otro")).toEqual([
      "Automocion",
      "Belleza",
      "Consultoria",
      "Dental",
      "Educacion",
      "Legal",
      "Retail",
      "SaaS",
    ]);
  });
});
