/**
 * Incidente 500 al indexar (aa-rag-index-failed-honesto) — un fallo de
 * embedding/guardado NO tumba la petición con 500.
 *
 * Cuando `saveChunkWithDuplicatePolicy` (→ embed() de OpenAI o INSERT pgvector)
 * LANZA, `ingestWebsite` ya NO propaga: aísla el fallo por chunk, degrada a un
 * estado honesto y devuelve un IngestResult. Si no se guardó nada pese a haber
 * texto legible → reason "index_failed" (distinto de "no_readable_text"). Si
 * unos chunks se guardan y otros fallan → cuenta los OK y no lanza.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// safeFetch mockeado (sin red). El resto de web.ts es real (htmlToText, chunkText
// — funciones puras, sin OpenAI/DB).
const safeFetch = vi.fn();
vi.mock("@/lib/ssrf", () => ({
  safeFetch: (...args: unknown[]) => safeFetch(...args),
  SsrfError: class SsrfError extends Error {},
}));
// El guardado por chunk se controla por caso: puede lanzar (embed/pgvector).
const saveChunk = vi.fn();
vi.mock("@/lib/knowledge-duplicates", () => ({
  saveChunkWithDuplicatePolicy: (...args: unknown[]) => saveChunk(...args),
}));

import { ingestWebsite } from "@/lib/scraper/web";

// Texto largo → chunkText produce VARIOS chunks (para el caso mixto ok/fallo).
const REAL_HTML =
  "<html><body><article><p>" +
  "El estudio ofrece formación profesional en tecnología y negocio con prácticas garantizadas en empresas del sector. ".repeat(
    120,
  ) +
  "</p></article></body></html>";

function htmlResponse(html: string) {
  return { ok: true, status: 200, text: async () => html };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("index_failed — fallo de embedding/guardado NO propaga (nunca 500)", () => {
  it("todos los chunks fallan al guardar → no lanza, chunks 0, reason 'index_failed'", async () => {
    safeFetch.mockResolvedValue(htmlResponse(REAL_HTML));
    saveChunk.mockRejectedValue(new Error("OpenAI 401 invalid api key"));

    const r = await ingestWebsite("a1", "https://ejemplo.test", false);

    expect(r.chunks).toBe(0);
    expect(r.reason).toBe("index_failed");
    // El texto SÍ se extrajo (hubo página con contenido), pero el índice falló.
    expect(r.pages).toBe(1);
  });

  it("unos chunks se guardan y otros fallan → cuenta los OK, no lanza, sin reason", async () => {
    safeFetch.mockResolvedValue(htmlResponse(REAL_HTML));
    // El primer chunk se guarda; el resto lanza. Debe contar 1 y continuar.
    saveChunk
      .mockResolvedValueOnce("saved")
      .mockRejectedValue(new Error("pgvector insert failed"));

    const r = await ingestWebsite("a1", "https://ejemplo.test", false);

    expect(r.chunks).toBe(1);
    // Con al menos 1 chunk guardado no hay reason (indexación parcial pero exitosa).
    expect(r.reason).toBeUndefined();
    expect(r.pages).toBe(1);
  });

  it("el progreso avanza pese al fallo de índice (llega a (total,total))", async () => {
    safeFetch.mockResolvedValue(htmlResponse(REAL_HTML));
    saveChunk.mockRejectedValue(new Error("embed threw"));
    const calls: Array<[number, number]> = [];

    await ingestWebsite("a1", "https://ejemplo.test", false, {
      onProgress: (done, total) => calls.push([done, total]),
    });

    expect(calls[0]).toEqual([0, 1]);
    expect(calls[calls.length - 1]).toEqual([1, 1]);
  });
});
