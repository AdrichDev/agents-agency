/**
 * aa-skills-propias-tenant (T4.4) — Comprueba que instalar una skill propia SE NOTA.
 *
 * Los tests de este change viven en mocks: demuestran que `usar_skill` devuelve
 * `curated: true` con el cuerpo dentro, pero no que un agente real llegue a pedir la skill
 * ni que lo que conteste cambie. Esto último es lo único que le importa a un tenant, y es
 * lo que este script mide contra la base y el LLM de verdad.
 *
 * Uso:
 *   npx tsx -r dotenv/config scripts/verify-builtin-skill.ts               # inspección
 *   npx tsx -r dotenv/config scripts/verify-builtin-skill.ts --run <id>    # conversa
 *
 * Método: mismo agente, misma pregunta, dos veces — sin la skill instalada y con ella. Si
 * las dos respuestas son intercambiables, instalar la skill no sirve de nada y hay que
 * decirlo, no maquillarlo.
 *
 * Las conversaciones se crean con `isTest: true`: son nuestras, no de un cliente, y no
 * deben contar como uso real en las estadísticas.
 */
import { prisma } from "@/lib/db";
import { chatWithAgent } from "@/lib/agent/engine";
import { BUILTIN_SKILLS } from "@/lib/skills/builtin-catalog";

const RUN = process.argv.includes("--run");
const agentId = process.argv[process.argv.indexOf("--run") + 1];
/**
 * Pasadas por rama. Por defecto 1: para T4.4 bastaba con una, porque lo que se demostraba era
 * cualitativo (¿el agente pide la skill por su cuenta?). Para MEDIR el coste hace falta n≥5:
 * `gpt-5.4-mini` rechaza `temperature`, así que la varianza entre pasadas es estructural y con
 * n pequeño produce señales limpias y falsas — pasó en `aa-agentes-economia-tokens` T5.3.
 */
const repeats = Number(
  process.argv.includes("--repeats") ? process.argv[process.argv.indexOf("--repeats") + 1] : 1,
);

/** La pregunta. Genérica a propósito: no menciona la skill ni pide un protocolo. */
const PREGUNTA = "Hola, quería pedir cita para la semana que viene. ¿Cómo lo hacemos?";
const SKILL = "3a/reserva-de-cita";

async function inspeccionar() {
  const agents = await prisma.agent.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      model: true,
      runtime: true,
      tenantId: true,
      _count: { select: { skills: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  console.log("Agentes (15 más recientes):");
  for (const a of agents) {
    console.log(
      `  ${a.id}  ${String(a.name).slice(0, 26).padEnd(26)} ${String(a.status).padEnd(10)} ` +
        `${String(a.model ?? "-").padEnd(14)} skills=${a._count.skills} tenant=${a.tenantId ?? "NULL"}`
    );
  }
  console.log(`\nSkills propias en catálogo: ${BUILTIN_SKILLS.length}`);
  console.log(`Para conversar:  --run <agentId>`);
}

/** Deja la skill instalada o desinstalada, y devuelve si hubo que cambiar algo. */
async function ponerSkill(agentId: string, instalada: boolean) {
  // `AgentSkill` no tiene `id`: su clave es compuesta (agentId, skillId).
  const skill = await prisma.skill.findUniqueOrThrow({ where: { name: SKILL } });
  const existe = await prisma.agentSkill.findFirst({
    where: { agentId, skillId: skill.id },
    select: { agentId: true },
  });

  if (instalada && !existe) {
    await prisma.agentSkill.create({ data: { agentId, skillId: skill.id } });
  } else if (!instalada && existe) {
    await prisma.agentSkill.deleteMany({ where: { agentId, skillId: skill.id } });
  }
  return skill.id;
}

async function conversar(etiqueta: string) {
  const res = await chatWithAgent(agentId, PREGUNTA, undefined, "widget", undefined, true);
  const texto = typeof res === "string" ? res : ((res as { reply?: string }).reply ?? JSON.stringify(res));
  console.log(`\n──── ${etiqueta} ────`);
  console.log(texto);
  return texto;
}

/**
 * Corre la rama N veces y devuelve los tokens FACTURADOS de cada pasada, leídos de `uso_tokens`.
 *
 * Se lee de la tabla, no del valor que devuelve el motor, a propósito: el cupo se descuenta de
 * `uso_tokens`, así que lo que decide si un agente se queda sin cupo es esta columna y no otra.
 * Medir cualquier otra cosa contestaría a una pregunta que nadie ha hecho.
 */
async function medirRama(etiqueta: string, veces: number) {
  const desde = new Date();
  for (let i = 0; i < veces; i++) {
    await conversar(`${etiqueta} · pasada ${i + 1}/${veces}`);
  }
  const filas = await prisma.tokenUsage.findMany({
    where: { agentId, createdAt: { gte: desde } },
    select: { tokens: true, contexto: true },
    orderBy: { createdAt: "asc" },
  });
  const tokens = filas.map((f) => f.tokens);
  const media = tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : 0;
  const iteraciones = filas
    .map((f) => (f.contexto as { iterations?: number } | null)?.iterations)
    .filter((n): n is number => typeof n === "number");
  const mediaIter = iteraciones.length
    ? (iteraciones.reduce((a, b) => a + b, 0) / iteraciones.length).toFixed(2)
    : "—";
  console.log(
    `\n>>> ${etiqueta}: n=${tokens.length} · tokens facturados [${tokens.join(", ")}] · ` +
      `media ${media} · iteraciones medias ${mediaIter}`,
  );
  return { media, tokens };
}

async function main() {
  if (!RUN || !agentId) return inspeccionar();

  const agente = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    select: { name: true, status: true, model: true },
  });
  console.log(`Agente: ${agente.name} (${agente.status}, ${agente.model})`);
  console.log(`Pregunta: "${PREGUNTA}"\n`);

  const skillId = await ponerSkill(agentId, false);
  const sin = await medirRama("SIN la skill instalada", repeats);

  await ponerSkill(agentId, true);
  const con = await medirRama("CON 3a/reserva-de-cita instalada", repeats);

  // Se deja como estaba antes de empezar: esto es una comprobación, no un cambio de
  // configuración del agente.
  await prisma.agentSkill.deleteMany({ where: { agentId, skillId } });

  console.log("\n──── Coste de instalar una skill ────");
  const factor = sin.media ? (con.media / sin.media).toFixed(2) : "—";
  console.log(`Media SIN: ${sin.media} tokens · Media CON: ${con.media} tokens · factor ×${factor}`);
  console.log(
    `Con el cupo por defecto (DEFAULT_TOKEN_QUOTA_PER_AGENT):\n` +
      `  sin skill → ${sin.media ? Math.floor(10_000_000 / sin.media).toLocaleString("es-ES") : "—"} turnos/mes\n` +
      `  con skill → ${con.media ? Math.floor(10_000_000 / con.media).toLocaleString("es-ES") : "—"} turnos/mes`,
  );
  if (repeats < 5) {
    console.log(
      `\n⚠ n=${repeats}. Con menos de 5 pasadas por rama esto NO es una medición, es una anécdota:\n` +
        `  el modelo no admite \`temperature\` y la varianza entre pasadas es estructural.`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
