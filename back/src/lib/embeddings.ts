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
  await prisma.$executeRaw`
    INSERT INTO "fragmento_conocimiento" ("id", "agente_id", "fuente", "contenido", "embedding")
    VALUES (gen_random_uuid()::text, ${agentId}, ${source}, ${content}, ${`[${vector.join(",")}]`}::vector)
  `;
}

/** Recupera los k chunks más similares a la consulta. */
export async function searchKnowledge(agentId: string, query: string, k = 5) {
  const vector = await embed(query);
  const rows = await prisma.$queryRaw<{ source: string; content: string; distance: number }[]>`
    SELECT "fuente" AS source, "contenido" AS content, "embedding" <=> ${`[${vector.join(",")}]`}::vector AS distance
    FROM "fragmento_conocimiento"
    WHERE "agente_id" = ${agentId} AND "embedding" IS NOT NULL
    ORDER BY distance ASC
    LIMIT ${k}
  `;
  return rows;
}

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
  return chunks.filter((c) => c.length > 50);
}
