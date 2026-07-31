/**
 * T1.1 (aa-agente-no-inventa-datos-ni-politicas) — ¿se puede convertir H4 en el caso vacío?
 *
 * El bloque de ausencia ya funciona, pero sólo dispara con CERO fragmentos, y H4 no es ese caso:
 * la pregunta por la cocina recupera el chunk del horario de RESERVAS y el modelo lo sirve como
 * si fuera la respuesta. Si ese acierto es flojo — distancia cerca del corte — apretar el umbral
 * de recuperación lo volvería el caso vacío, donde T1.1 ya acierta 3/3.
 *
 * Lo que decide es el margen: la pregunta rota tiene que quedar por encima del corte y las filas
 * de AC6 (las que HOY responden bien) por debajo. Sin ese hueco, apretar cuesta conocimiento y
 * el remedio es peor.
 *
 * Uso: npx tsx scripts/diag-distancia-h4.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { openai } from "../src/lib/openai";

/** Mismo modelo que `embeddings.ts`; ahí `embed` es privada. */
async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8000),
  });
  return res.data[0].embedding;
}

/** Preguntas que HOY se responden bien (AC6) y la que inventa (H4). */
const CONSULTAS: { agente: string; etiqueta: string; pregunta: string }[] = [
  { agente: "Lafayette", etiqueta: "H4  INVENTA", pregunta: "¿A qué hora cierra la cocina?" },
  { agente: "Lafayette", etiqueta: "M2  ok", pregunta: "¿Qué alérgenos tienen las croquetas de jamón?" },
  { agente: "Lafayette", etiqueta: "M4  ok", pregunta: "¿Tenéis algún plato vegetariano?" },
  { agente: "Lafayette", etiqueta: "H4b INVENTA", pregunta: "¿Hasta qué hora sirven comidas en la cocina?" },
  { agente: "Mendieta", etiqueta: "M1  ok", pregunta: "¿Cuánto cuestan las croquetas de jamón?" },
  { agente: "Núñez", etiqueta: "SEC2 ok", pregunta: "¿Cuánto cuesta corte y barba y cuánto dura?" },
];

async function main() {
  for (const c of CONSULTAS) {
    const agent = await prisma.agent.findFirst({
      where: { name: { contains: c.agente } },
      select: { id: true, name: true },
    });
    if (!agent) {
      console.log(`${c.etiqueta.padEnd(12)} · agente "${c.agente}" no encontrado`);
      continue;
    }

    const vector = await embed(c.pregunta);
    // Sin corte ni margen: se quieren ver las distancias en crudo, incluidas las descartadas.
    const filas = await prisma.$queryRawUnsafe<{ contenido: string; distancia: number }[]>(
      `SELECT contenido, (embedding <=> $1::vector) AS distancia
         FROM aa.fragmento_conocimiento
        WHERE agente_id = $2
        ORDER BY distancia ASC
        LIMIT 5`,
      `[${vector.join(",")}]`,
      agent.id
    );

    console.log(`\n${c.etiqueta} · ${agent.name} · "${c.pregunta}"`);
    filas.forEach((f, i) => {
      console.log(`   ${i + 1}. d=${Number(f.distancia).toFixed(4)}  ${f.contenido.replace(/\s+/g, " ").slice(0, 95)}`);
    });
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
