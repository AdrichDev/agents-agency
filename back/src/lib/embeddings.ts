import { prisma } from "@/lib/db";
import { openai } from "@/lib/openai";

async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8000),
  });
  return res.data[0].embedding;
}

/** Guarda un chunk de conocimiento con su embedding (pgvector). */
export async function saveChunk(agentId: string, source: string, content: string) {
  const vector = await embed(content);
  // Schema cualificado ("aa"): el search_path de la conexión no siempre incluye
  // `aa`, así que el SQL crudo debe nombrar la tabla con su schema o falla con
  // "relation does not exist" (a diferencia de las queries de modelo de Prisma,
  // que se cualifican solas).
  await prisma.$executeRaw`
    INSERT INTO "aa"."fragmento_conocimiento" ("id", "agente_id", "fuente", "contenido", "embedding")
    VALUES (gen_random_uuid()::text, ${agentId}, ${source}, ${content}, ${`[${vector.join(",")}]`}::vector)
  `;
}

/**
 * B (aa-agentes-economia-tokens, T2.2): techo absoluto de distancia. Deliberadamente flojo. Medido
 * sobre DorsIA, Agente EDM San Blas y SanBlasIA: por encima de 0.85 no aparece NI UN acierto, y sí
 * basura evidente (una pregunta sobre elefantes da 0.9045). No sirve como filtro fino — los rangos
 * de acierto y fallo se solapan entre agentes (peor acierto 0.7499 vs. mejor fallo 0.7248) — solo
 * como red de seguridad.
 */
const MAX_DISTANCE = 0.85;

/**
 * B (T2.2): poda relativa. Se conserva el vecino más próximo y se descartan los que estén a más de
 * este margen de distancia de él. Autoajustable: no depende de la calidad absoluta del corpus de
 * cada agente, solo de cuánto peores son los demás vecinos que el mejor. Medido en los tres agentes:
 * cero preguntas legítimas se quedan sin ningún fragmento, y el ruido cae de 25 a 11-12 fragmentos.
 */
const RELATIVE_MARGIN = 0.08;

/**
 * Recupera los k chunks más similares a la consulta.
 *
 * B (T2.2): `k` baja de 5 a 3 y se filtra el ruido. `DISTINCT ON ("contenido")` es el filtro que más
 * ahorra y el único sin riesgo: entre el 22% y el 39% de los fragmentos indexados son duplicados
 * literales (boilerplate de navegación repetido en cada página scrapeada). Al ser texto idéntico
 * tienen embedding idéntico, así que se agrupan en la cabeza del ranking y la búsqueda devolvía el
 * MISMO párrafo hasta cinco veces.
 */
export async function searchKnowledge(agentId: string, query: string, k = 3) {
  const vector = await embed(query);
  // `DISTINCT ON` obliga a ordenar por "contenido" primero, así que la deduplicación va en una
  // subconsulta y el orden por distancia se aplica fuera. Si se pusiera el LIMIT dentro se cogerían
  // los fragmentos primeros por orden alfabético, no los más cercanos.
  const rows = await prisma.$queryRaw<{ source: string; content: string; distance: number }[]>`
    SELECT d.source, d.content, d.distance
    FROM (
      SELECT DISTINCT ON ("contenido")
             "fuente" AS source, "contenido" AS content,
             "embedding" <=> ${`[${vector.join(",")}]`}::vector AS distance
      FROM "aa"."fragmento_conocimiento"
      WHERE "agente_id" = ${agentId} AND "embedding" IS NOT NULL
      ORDER BY "contenido", distance ASC
    ) d
    ORDER BY d.distance ASC
    LIMIT ${k}
  `;
  const best = rows[0];
  if (!best || Number(best.distance) > MAX_DISTANCE) return [];
  return rows.filter((r) => Number(r.distance) <= Number(best.distance) + RELATIVE_MARGIN);
}

// F4: umbral mínimo de longitud de un chunk. Se baja de 50 a 25 para no perder
// el único contenido útil cuando una web deja poco texto legible (antes un chunk
// de 30-49 chars se descartaba entero). Fragmentos triviales (<25) siguen fuera.
const MIN_CHUNK_CHARS = 25;

/** Trocea texto en chunks de ~1000 caracteres respetando párrafos. */
export function chunkText(text: string, maxLen = 1000): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > maxLen && current) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length >= MIN_CHUNK_CHARS);
}
