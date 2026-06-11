import { describe, it, expect } from "vitest";
import { chunkText } from "@/lib/embeddings";

describe("chunkText", () => {
  it("trocea texto largo en chunks", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Párrafo ${i} `.repeat(20)).join("\n\n");
    const chunks = chunkText(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1400);
  });

  it("descarta fragmentos demasiado cortos", () => {
    expect(chunkText("hola")).toHaveLength(0);
  });

  it("mantiene un párrafo único largo", () => {
    const text = "x".repeat(900);
    expect(chunkText(text)).toHaveLength(1);
  });
});
