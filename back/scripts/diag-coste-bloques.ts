/**
 * Coste en tokens de los dos bloques nuevos de T1 (aa-agente-no-inventa-datos-ni-politicas).
 *
 * No se estima por caracteres: se pregunta al propio tokenizador del modelo. Una completion con
 * `max_completion_tokens: 1` devuelve `usage.prompt_tokens` exacto, así que el coste del bloque
 * es la diferencia entre el mismo prompt con y sin él. Dos llamadas por bloque, céntimos.
 *
 * Uso: npx tsx scripts/diag-coste-bloques.ts
 */
import "dotenv/config";
import { openai } from "../src/lib/openai";
import { buildContextFactsBlock, buildKnowledgeBlock } from "../src/lib/agent/engine";

const MODELO = "gpt-4.1-nano";

async function tokensDelPrompt(texto: string): Promise<number> {
  const res = await openai.chat.completions.create({
    model: MODELO,
    messages: [{ role: "system", content: texto }],
    max_completion_tokens: 1,
  });
  return res.usage?.prompt_tokens ?? -1;
}

async function coste(etiqueta: string, bloque: string | null) {
  if (bloque === null) {
    console.log(`${etiqueta.padEnd(34)} · no emite bloque · 0 tokens`);
    return;
  }
  // El sistema vacío no es 0 tokens (hay andamiaje de rol), así que se resta la misma base.
  const base = await tokensDelPrompt("x");
  const con = await tokensDelPrompt(`x\n${bloque}`);
  console.log(`${etiqueta.padEnd(34)} · ${con - base} tokens · ${bloque.length} caracteres`);
}

async function main() {
  await coste("T1.1 ausencia (0 fragmentos)", buildKnowledgeBlock([]));
  await coste("T1.2 aviso de nombre", buildContextFactsBlock("teléfono: 622334455", false));
  await coste("T1.2 sin aviso (nombre conocido)", buildContextFactsBlock("teléfono: 622334455", true));
  await coste("T1.2 turno corriente (sin datos)", buildContextFactsBlock(null, false));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
