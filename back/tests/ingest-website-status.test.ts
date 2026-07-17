/**
 * F2/F3 (aa-rag-extraccion-estatica-honesta) — estado honesto de la ingesta web.
 *
 * ingestWebsite deja de tragar errores en silencio: propaga `reason` cuando no
 * indexa nada (timeout/fetch_failed/no_readable_text) y cuenta páginas con
 * contenido real. refreshInitialIngestStatus nunca marca `indexed` con 0 chunks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// safeFetch mockeado por caso (sin red). El resto de web.ts es real (htmlToText,
// chunkText real vía embeddings — funciones puras, sin OpenAI/DB).
const safeFetch = vi.fn();
vi.mock("@/lib/ssrf", () => ({
  safeFetch: (...args: unknown[]) => safeFetch(...args),
  SsrfError: class SsrfError extends Error {},
}));
// No tocar la BD al guardar chunks.
const saveChunk = vi.fn().mockResolvedValue("saved");
vi.mock("@/lib/knowledge-duplicates", () => ({
  saveChunkWithDuplicatePolicy: (...args: unknown[]) => saveChunk(...args),
}));

import { ingestWebsite } from "@/lib/scraper/web";

const REAL_HTML =
  "<html><body><article><p>" +
  "El estudio ofrece formación profesional en tecnología y negocio con prácticas garantizadas en empresas del sector. ".repeat(3) +
  "</p></article></body></html>";

function htmlResponse(html: string) {
  return { ok: true, status: 200, text: async () => html };
}

beforeEach(() => {
  vi.clearAllMocks();
  saveChunk.mockResolvedValue("saved");
});

describe("F3 — ingestWebsite propaga el motivo (no más silencio)", () => {
  it("timeout de fetch → chunks 0 + reason 'timeout'", async () => {
    const err = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    safeFetch.mockRejectedValue(err);

    const r = await ingestWebsite("a1", "https://ejemplo.test", false);

    expect(r.chunks).toBe(0);
    expect(r.reason).toBe("timeout");
  });

  it("fallo HTTP de fetch → chunks 0 + reason 'fetch_failed'", async () => {
    safeFetch.mockResolvedValue({ ok: false, status: 503, text: async () => "" });

    const r = await ingestWebsite("a1", "https://ejemplo.test", false);

    expect(r.chunks).toBe(0);
    expect(r.reason).toBe("fetch_failed");
  });
});

describe("F2 — estado honesto por conteo real", () => {
  it("web sin texto legible → chunks 0 + reason 'no_readable_text'", async () => {
    safeFetch.mockResolvedValue(htmlResponse("<html><body></body></html>"));

    const r = await ingestWebsite("a1", "https://ejemplo.test", false);

    expect(r.chunks).toBe(0);
    expect(r.reason).toBe("no_readable_text");
    expect(r.pages).toBe(0); // páginas con contenido real
  });

  it("web con texto → chunks > 0, sin reason, 1 página con contenido", async () => {
    safeFetch.mockResolvedValue(htmlResponse(REAL_HTML));

    const r = await ingestWebsite("a1", "https://ejemplo.test", false);

    expect(r.chunks).toBeGreaterThan(0);
    expect(r.reason).toBeUndefined();
    expect(r.pages).toBe(1);
  });
});
