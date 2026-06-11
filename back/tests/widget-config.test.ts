import { describe, expect, it } from "vitest";
import { normalizeColorValue } from "@/lib/widget-config";

describe("widget config", () => {
  it("accepts hex colors", () => {
    expect(normalizeColorValue("#4f46e5")).toBe("#4f46e5");
  });

  it("converts rgb colors to hex", () => {
    expect(normalizeColorValue("rgb(79, 70, 229)")).toBe("#4f46e5");
  });
});
