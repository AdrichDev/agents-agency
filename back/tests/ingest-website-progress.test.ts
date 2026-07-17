/**
 * T1.1 (aa-knowledge-progreso-indexado) — `ingestWebsite` emite progreso.
 *
 * El callback opcional `onProgress(done,total)` se llama (0,total) al empezar y
 * de forma incremental hasta (total,total) tras procesar cada página, en orden.
 * web.ts se mantiene agnóstico de BD: solo notifica por callback. Sin callback el
 * comportamiento es el de hoy (regresión cero).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// safeFetch mockeado (sin red). El resto de web.ts es real (discoverLinks,
// htmlToText, chunkText — funciones puras, sin OpenAI/DB).
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

const ARTICLE =
  "<article><p>" +
  "El estudio ofrece formación profesional en tecnología y negocio con prácticas garantizadas en empresas del sector. ".repeat(3) +
  "</p></article>";

// HTML con 2 enlaces internos + contenido: discoverLinks extrae /a y /b; cada
// página (misma respuesta) aporta texto legible → chunks.
const HTML_WITH_LINKS =
  "<html><body>" +
  '<a href="https://ejemplo.test/a">a</a>' +
  '<a href="https://ejemplo.test/b">b</a>' +
  ARTICLE +
  "</body></html>";

function htmlResponse(html: string) {
  return { ok: true, status: 200, text: async () => html };
}

beforeEach(() => {
  vi.clearAllMocks();
  saveChunk.mockResolvedValue("saved");
});

describe("T1.1 — ingestWebsite emite progreso por página", () => {
  it("llama onProgress (0,total) y luego incremental hasta (total,total) en orden", async () => {
    safeFetch.mockResolvedValue(htmlResponse(HTML_WITH_LINKS));
    const calls: Array<[number, number]> = [];

    await ingestWebsite("a1", "https://ejemplo.test", true, {
      onProgress: (done, total) => calls.push([done, total]),
    });

    // 3 páginas: base + /a + /b → total = 3.
    const total = 3;
    expect(calls[0]).toEqual([0, total]);
    expect(calls[calls.length - 1]).toEqual([total, total]);
    // Secuencia completa y monótona: (0,3),(1,3),(2,3),(3,3).
    expect(calls).toEqual([
      [0, total],
      [1, total],
      [2, total],
      [3, total],
    ]);
  });

  it("avanza el progreso aunque una página falle (crawl simple, 1 página)", async () => {
    const err = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    safeFetch.mockRejectedValue(err);
    const calls: Array<[number, number]> = [];

    await ingestWebsite("a1", "https://ejemplo.test", false, {
      onProgress: (done, total) => calls.push([done, total]),
    });

    // 1 sola página (crawl=false); pese al fallo el progreso llega a (1,1).
    expect(calls).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it("sin onProgress no rompe (regresión cero)", async () => {
    safeFetch.mockResolvedValue(htmlResponse(ARTICLE));

    const r = await ingestWebsite("a1", "https://ejemplo.test", false);

    expect(r.chunks).toBeGreaterThan(0);
  });
});
