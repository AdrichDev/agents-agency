/**
 * B / T2.2 (aa-agentes-economia-tokens) — searchKnowledge deja de inyectar ruido.
 *
 * Antes: `ORDER BY distance LIMIT 5` sin filtro alguno. Devolvía siempre los 5 vecinos menos malos,
 * aunque los 5 fueran irrelevantes (~1400 tokens de ruido por mensaje), y con los duplicados
 * literales del corpus agrupados en cabeza podía devolver el MISMO párrafo cinco veces.
 *
 * Ahora: deduplicación por contenido en la query, k por defecto 3, poda relativa (+0.08 sobre el
 * mejor vecino) y techo absoluto permisivo (0.85). Los valores están calibrados con datos reales de
 * DorsIA, Agente EDM San Blas y SanBlasIA — ver §D2 del diseño.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock("@/lib/openai", () => ({
  openai: { embeddings: { create: vi.fn(async () => ({ data: [{ embedding: [0.1, 0.2] }] })) } },
}));

import { prisma } from "@/lib/db";
import { searchKnowledge } from "@/lib/embeddings";

const mockQuery = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;

function chunk(distance: number, content = `c${distance}`) {
  return { source: "web:home", content, distance };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchKnowledge — relevancia (T2.2)", () => {
  it("k por defecto es 3, no 5", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await searchKnowledge("a1", "horario");

    // El k viaja como parámetro del LIMIT: última posición de los valores interpolados.
    const params = mockQuery.mock.calls[0].slice(1).flat();
    expect(params).toContain(3);
  });

  it("deduplica por contenido en la propia consulta", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await searchKnowledge("a1", "horario");

    const sql = (mockQuery.mock.calls[0][0] as string[]).join("");
    expect(sql).toContain('DISTINCT ON ("contenido")');
    // El LIMIT va FUERA de la subconsulta: dentro cogería los primeros por orden alfabético de
    // contenido, no los más cercanos.
    expect(sql).toMatch(/\)\s*d\s*ORDER BY d\.distance ASC\s*LIMIT/);
  });

  // E4: por encima del techo absoluto no se devuelve nada, en vez de los menos malos.
  it("devuelve vacío si el mejor vecino supera el techo absoluto", async () => {
    mockQuery.mockResolvedValueOnce([chunk(0.9), chunk(0.91), chunk(0.92)]);

    expect(await searchKnowledge("a1", "cuánto pesa un elefante")).toEqual([]);
  });

  it("el techo es permisivo: 0.85 justo pasa", async () => {
    mockQuery.mockResolvedValueOnce([chunk(0.85)]);

    expect(await searchKnowledge("a1", "q")).toHaveLength(1);
  });

  // E5: un acierto claro se conserva con su source y su distance.
  it("conserva el acierto con source y distance intactos", async () => {
    mockQuery.mockResolvedValueOnce([{ source: "faq.pdf", content: "Abrimos de 9 a 14", distance: 0.42 }]);

    const rows = await searchKnowledge("a1", "horario");

    expect(rows).toEqual([{ source: "faq.pdf", content: "Abrimos de 9 a 14", distance: 0.42 }]);
  });

  it("poda los vecinos mucho peores que el mejor", async () => {
    // 0.40 es el mejor; el margen es 0.08, así que 0.45 entra y 0.60 se cae.
    mockQuery.mockResolvedValueOnce([chunk(0.4), chunk(0.45), chunk(0.6)]);

    const rows = await searchKnowledge("a1", "horario");

    expect(rows.map((r) => r.distance)).toEqual([0.4, 0.45]);
  });

  it("no poda cuando los vecinos están igual de cerca", async () => {
    mockQuery.mockResolvedValueOnce([chunk(0.5), chunk(0.52), chunk(0.55)]);

    expect(await searchKnowledge("a1", "horario")).toHaveLength(3);
  });

  it("sin fragmentos indexados devuelve vacío sin fallar", async () => {
    mockQuery.mockResolvedValueOnce([]);

    expect(await searchKnowledge("a1", "horario")).toEqual([]);
  });

  it("respeta el k explícito del panel de inspección del propietario", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await searchKnowledge("a1", "horario", 5);

    const params = mockQuery.mock.calls[0].slice(1).flat();
    expect(params).toContain(5);
  });
});
