/**
 * T2 (aa-agente-no-inventa-datos-ni-politicas) — cuánto y qué retira el filtro de citas.
 *
 * Recorre TODAS las respuestas históricas que llevan `(fuente: …)`, vuelve a recuperar el
 * conocimiento con el mensaje del usuario que las provocó — el mismo camino que siguió el turno —
 * y dice si cada cita resuelve contra un fragmento entregado.
 *
 * DOS AVISOS SOBRE ESTA MEDICIÓN, porque cambia cómo se leen los números:
 *
 * 1. La recuperación de hoy no es la del turno: el índice ha cambiado desde entonces y la
 *    respuesta pudo llegar por la tool `search_knowledge` con otra consulta. Este replay sólo
 *    puede SOBREESTIMAR las retiradas. En ejecución real los fragmentos son los del propio turno.
 * 2. El mensaje de usuario que provocó la respuesta NO se puede buscar por `createdAt` menor:
 *    los dos mensajes se insertan en la misma transacción y comparten `now()` al milisegundo.
 *    Se busca por posición dentro de la conversación.
 *
 * Uso: npx tsx scripts/diag-citas-respaldadas.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { publicSource, searchKnowledge } from "../src/lib/embeddings";
import {
  citaResuelve,
  referenciasDeLaCita,
  resolverFragmento,
  type FragmentoCitable,
} from "../src/lib/agent/citation-support";

const CITA = /\s*\(\s*fuente\s*:\s*((?:[^()]|\([^()]*\))*)\)/gi;

type Caso = {
  agente: string;
  ref: string;
  refs: string[];
  resuelve: boolean;
  fuentes: string[];
};

function clase(refs: string[]): string {
  if (!refs.length) return "vacia";
  if (refs.every((r) => /^https?:\/\//i.test(r))) return "url";
  if (refs.every((r) => /^\d+$/.test(r))) return "indice";
  return "prosa";
}

async function main() {
  const conCita = await prisma.message.findMany({
    where: { role: "assistant", content: { contains: "uente:" } },
    select: { id: true, content: true, conversationId: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  console.log(`respuestas historicas con cita: ${conCita.length}`);

  const casos: Caso[] = [];
  let sinPregunta = 0;

  for (const msg of conCita) {
    const hilo = await prisma.message.findMany({
      where: { conversationId: msg.conversationId },
      select: { id: true, role: true, content: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const pos = hilo.findIndex((m) => m.id === msg.id);
    let previo: string | null = null;
    for (let i = pos - 1; i >= 0; i -= 1) {
      if (hilo[i].role === "user") {
        previo = hilo[i].content;
        break;
      }
    }
    const conv = await prisma.conversation.findUnique({
      where: { id: msg.conversationId },
      select: { agentId: true, agent: { select: { name: true } } },
    });
    if (!previo || !conv?.agentId) {
      sinPregunta += 1;
      continue;
    }

    const rows = await searchKnowledge(conv.agentId, previo);
    const citables: FragmentoCitable[] = rows.map((r, i) => ({
      indice: i + 1,
      fuente: publicSource(r.source),
      contenido: r.content,
    }));

    CITA.lastIndex = 0;
    for (let m = CITA.exec(msg.content); m; m = CITA.exec(msg.content)) {
      const ref = m[1] ?? "";
      casos.push({
        agente: conv.agent?.name ?? "?",
        ref: ref.trim() || "(vacia)",
        refs: referenciasDeLaCita(ref),
        resuelve: citaResuelve(ref, citables),
        fuentes: citables.map((c) => c.fuente ?? "(sin url)"),
      });
    }
  }

  console.log(`descartadas por no hallar la pregunta: ${sinPregunta}`);
  console.log(`citas encontradas: ${casos.length}\n`);

  const porClase = new Map<string, { total: number; retiradas: number }>();
  for (const c of casos) {
    const k = clase(c.refs);
    const acc = porClase.get(k) ?? { total: 0, retiradas: 0 };
    acc.total += 1;
    if (!c.resuelve) acc.retiradas += 1;
    porClase.set(k, acc);
  }

  console.log("=== por forma de la referencia ===");
  for (const [k, v] of porClase) console.log(`  ${k.padEnd(7)} ${v.retiradas}/${v.total} retiradas`);

  console.log("\n=== retiradas, una a una ===");
  for (const c of casos.filter((x) => !x.resuelve)) {
    const cuales = c.refs
      .map((r) => `${r}${resolverFragmento(r, []) ? "" : ""}`)
      .join(" + ");
    console.log(`  [${clase(c.refs)}] ${c.agente} · "${c.ref}"`);
    console.log(`      refs=${cuales || "(ninguna)"}`);
    console.log(`      entregado: ${c.fuentes.join(" | ") || "(nada)"}`);
  }

  console.log("\n=== conservadas ===");
  for (const c of casos.filter((x) => x.resuelve)) {
    console.log(`  [${clase(c.refs)}] ${c.agente} · "${c.ref}"`);
  }

  const retiradas = casos.filter((c) => !c.resuelve).length;
  console.log(`\nTOTAL: ${retiradas}/${casos.length} citas retiradas`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
