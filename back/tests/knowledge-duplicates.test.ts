import { describe, expect, it } from "vitest";
import { nextDuplicateSource } from "@/lib/knowledge-duplicates";

describe("knowledge duplicate handling", () => {
  it("adds an incrementing suffix before saving duplicate sources", () => {
    expect(nextDuplicateSource("https://site.com/page", [])).toBe("https://site.com/page_1");
    expect(nextDuplicateSource("https://site.com/page", ["https://site.com/page_1"])).toBe("https://site.com/page_2");
  });
});
