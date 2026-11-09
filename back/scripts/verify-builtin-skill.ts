/**
 * aa-skills-propias-tenant (T4.4) — ¿Se NOTA instalar una skill? Medición A/B objetiva.
 *
 * Qué mide. El MISMO agente, el MISMO escenario y el MISMO modelo, dos veces: sin la skill
 * instalada y con ella. Con la skill instalada el agente tiene que cargar el protocolo por su
 * cuenta (`usar_skill`) y su respuesta tiene que cumplir una regla que se pueda comprobar con
 * texto — recapitular la cita, no repetir una tarjeta, no usar emoji ante una queja. Las tres
 * reglas viven en `src/lib/skills/skill-effect.ts` con test unitario; aquí no hay criterios
 * escondidos, sólo ejecución y recuento.
 *
 * Por qué no basta con mirar las respuestas. Dos textos distintos no son dos conductas
 * distintas: la varianza de redacción del modelo produce diferencias en todas las pasadas, con
 * skill y sin ella. Sin un criterio previo, "se nota" es lo que uno quiera ver.
 *
 * Uso:
 *   npx tsx -r dotenv/config scripts/verify-builtin-skill.ts                       # inspección
 *   npx tsx -r dotenv/config scripts/verify-builtin-skill.ts --run <agentId> \
 *     --model nan/glm5.3-flash --repeats 3
 *   npx tsx -r dotenv/config scripts/verify-builtin-skill.ts --run <agentId> \
 *     --scenario '3a/reserva-de-cita:Hola, quiero una revisión del coche el jueves a las \
 *     17:00. Me llamo Marta, ¿me lo dejas apuntado?'
 *
 * `--scenario <skill>:<mensaje>` (repetible) sustituye el mensaje del visitante. Existe porque
 * el guión de la reserva nombra un servicio concreto ("corte de pelo") y el negocio real del
 * agente puede ser un taller o una clínica: el criterio es el mismo (`skill-effect.ts`), el
 * sujeto cambia. El mensaje debe nombrar un servicio reconocible (corte, cita, consulta,
 * revisión, sesión, masaje, mesa, visita, clase…), un día y una hora — si no, la recapitulación
 * no se puede exigir y el informe mediría una respuesta imposible.
 *
 * Veredictos: `SE NOTA`, `YA CUMPLE SIN SKILL` (ambas ramas al 100%: la conducta ya estaba, no es
 * un fallo de la skill), `NO SE NOTA` y `NO CONCLUYENTE`.
 *
 * MUTA, Y SIEMPRE DESHACE. Para montar cada rama reemplaza la lista de skills del agente
 * (`setAgentSkills`, reemplazo declarativo) y, si se pide `--model`, su modelo. Nada de eso es
 * una decisión de configuración: se toma una foto del estado original antes de empezar y se
 * restaura en un `finally` — y también con Ctrl-C — imprimiendo el estado final para que se
 * pueda comprobar a ojo. Lo único que el script deja detrás son conversaciones de prueba
 * (`isTest: true`): son nuestras, no de un cliente, y no cuentan como uso real en las
 * estadísticas. No se borra ninguna conversación ni ningún otro dato.
 *
 * Se niega a correr contra un agente publicado (`published`) salvo `--allow-published`: el
 * sujeto de la prueba es un borrador o un agente de demostración. Un agente publicado es el que
 * está atendiendo clientes de verdad.
 */
import { prisma } from "@/lib/db";
import { chatWithAgent } from "@/lib/agent/engine";
import { setAgentSkills } from "@/lib/agent/service";
import type { ToolCallRecord } from "@/lib/agent/types";
import { BUILTIN_SKILLS } from "@/lib/skills/builtin-catalog";
import {
  SKILL_SCENARIOS,
  calledUsarSkill,
  scenarioForSkill,
  scenarioWithMessage,
  skillVerdict,
  type SkillVerdictValue,
} from "@/lib/skills/skill-effect";

/* ────────────────────────────────────────────────────────────────────────────
 * CLI
 * ──────────────────────────────────────────────────────────────────────────── */

/** Valor de `--flag`; `undefined` si no está, si es el último argumento o si le sigue otro flag. */
function flag(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  if (i < 0) return undefined;
  const valor = process.argv[i + 1];
  return valor && !valor.startsWith("--") ? valor : undefined;
}

function flagBooleano(nombre: string): boolean {
  return process.argv.includes(`--${nombre}`);
}

/**
 * Overrides del mensaje del visitante: `--scenario <skill>:<mensaje>`, repetible.
 *
 * Por qué. El escenario de la reserva nace con un servicio concreto (una peluquería, "corte de
 * pelo"). Medir un taller, una clínica o un restaurante con ese guión mide otra cosa. Con este
 * flag se lanza el MISMO criterio sobre el negocio real del agente. El primer `:` separa el
 * nombre de la skill del mensaje (los nombres no llevan dos puntos).
 */
function overridesDeEscenario(): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== "--scenario") continue;
    const valor = process.argv[i + 1];
    if (!valor || valor.startsWith("--")) continue;
    const corte = valor.indexOf(":");
    if (corte <= 0) continue;
    const skill = valor.slice(0, corte).trim();
    const mensaje = valor.slice(corte + 1).trim();
    if (skill && mensaje) out.set(skill, mensaje);
  }
  return out;
}

const REPEATS_POR_DEFECTO = 3;

const agentId = flag("run");
const modeloSolicitado = flag("model");
const repeatsCrudo = Number(flag("repeats") ?? REPEATS_POR_DEFECTO);
const repeats =
  Number.isFinite(repeatsCrudo) && repeatsCrudo >= 1 ? Math.floor(repeatsCrudo) : REPEATS_POR_DEFECTO;
const allowPublished = flagBooleano("allow-published");
const overridesEscenario = overridesDeEscenario();
const skillsSolicitadas = (flag("skills") ?? SKILL_SCENARIOS.map((s) => s.skill).join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** El escenario de la skill, con el mensaje que haya pedido `--scenario`. */
function escenarioDe(skill: string) {
  const base = scenarioForSkill(skill)!;
  const override = overridesEscenario.get(skill);
  return override ? scenarioWithMessage(skill, override)! : base;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Inspección (sin `--run`): qué agentes hay, para elegir uno.
 * ──────────────────────────────────────────────────────────────────────────── */

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
        `${String(a.model ?? "-").padEnd(14)} skills=${a._count.skills} tenant=${a.tenantId ?? "NULL"}`,
    );
  }
  console.log(`\nSkills propias en catálogo: ${BUILTIN_SKILLS.length}`);
  console.log(`Escenarios con comprobación objetiva: ${SKILL_SCENARIOS.map((s) => s.skill).join(", ")}`);
  console.log(
    "\nPara medir (elige un agente en estado draft; el script restaura lo que toque):\n" +
      "  npx tsx -r dotenv/config scripts/verify-builtin-skill.ts " +
      "--run <agentId> --model nan/glm5.3-flash --repeats 3\n" +
      "  Opciones: --skills a,b,c · --allow-published (NO recomendado)\n" +
      "  --scenario <skill>:<mensaje>  cambia el mensaje del visitante (repetible). " +
      "Úsalo cuando el negocio del agente no sea el del guión (p. ej. un taller o una clínica en " +
      "vez de una peluquería). El mensaje debe nombrar un servicio del negocio con una palabra " +
      "que el criterio reconozca: corte, cita, consulta, revisión, sesión, masaje, mesa, visita, " +
      "clase…, y además día y hora, para que la recapitulación sea exigible.\n" +
      "  Ejemplo: --scenario '3a/reserva-de-cita:Hola, quiero una revisión del coche el jueves a " +
      "las 17:00. Me llamo Marta, ¿me lo dejas apuntado?'",
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Foto del estado original y su restauración.
 *
 * La restauración es lo único de este script que no puede fallar en silencio: si se queda a
 * medias, el agente de alguien se queda con las skills de la prueba. Por eso es idempotente,
 * corre en `finally` y en SIGINT, e imprime el estado final para que se pueda verificar.
 * ──────────────────────────────────────────────────────────────────────────── */

interface Foto {
  agentId: string;
  skillIds: string[];
  skillNames: string[];
  model: string;
  /** `false` cuando el modelo pedido coincide con el del agente: no se toca. */
  modeloCambiado: boolean;
}

let foto: Foto | null = null;
let restaurando: Promise<void> | null = null;

function restaurar(): Promise<void> {
  restaurando ??= (async () => {
    if (!foto) return;
    const f = foto;
    // `setAgentSkills` es el MISMO camino que usa el panel: si aquí se hiciera un
    // delete/create a mano, la restauración podría perder el secreto MCP per-agente que esa
    // función se encarga de conservar.
    await setAgentSkills(f.agentId, f.skillIds);
    if (f.modeloCambiado) {
      await prisma.agent.update({ where: { id: f.agentId }, data: { model: f.model } });
    }
    const despues = await prisma.agent.findUniqueOrThrow({
      where: { id: f.agentId },
      select: {
        model: true,
        runtime: true,
        skills: { select: { skill: { select: { name: true } } } },
      },
    });
    const nombres = despues.skills
      .map((s) => s.skill?.name)
      .filter((n): n is string => Boolean(n))
      .sort();
    const iguales =
      nombres.length === f.skillNames.length && nombres.every((n, i) => n === [...f.skillNames].sort()[i]);
    console.log("\n──── Estado restaurado ────");
    console.log(`  modelo: ${despues.model}${f.modeloCambiado ? ` (era ${f.model} antes de la prueba)` : ""}`);
    console.log(`  skills: ${nombres.length ? nombres.join(", ") : "(ninguna)"}`);
    console.log(`  ${iguales ? "✓ coincide con la foto inicial" : "⚠ NO coincide con la foto inicial"}`);
  })().catch((e) => {
    // Restaurar mal es peor que medir mal: el agente queda con las skills de la prueba. Se
    // avisa en rojo y se deja el código de salida en error, aunque el informe sea correcto.
    console.error(
      "\n✗ NO se pudo restaurar el estado original del agente:",
      e instanceof Error ? e.message : e,
      `\n  Restaura a mano: skills=${foto?.skillIds.join(",") || "(ninguna)"} model=${foto?.model ?? "?"}`,
    );
    process.exitCode = 1;
  });
  return restaurando;
}

process.on("SIGINT", () => {
  console.log("\n\nCtrl-C: restaurando antes de salir…");
  void restaurar().finally(() => process.exit(130));
});

/* ────────────────────────────────────────────────────────────────────────────
 * Ejecución
 * ──────────────────────────────────────────────────────────────────────────── */

interface Pasada {
  skill: string;
  repeat: number;
  conSkill: boolean;
  reply: string;
  pass: boolean;
  reasons: string[];
  llamado: boolean;
  tokens: number;
  error?: string;
}

/**
 * Un turno de conversación de prueba. La conversación nace con `isTest: true`: el gasto no
 * toca el cupo del cliente y las estadísticas del panel no la cuentan como uso real.
 */
async function conversar(mensajes: readonly string[]): Promise<{
  reply: string;
  toolCalls: ToolCallRecord[];
  tokens: number;
}> {
  let conversationId: string | undefined;
  let reply = "";
  let toolCalls: ToolCallRecord[] = [];
  let tokens = 0;

  for (const mensaje of mensajes) {
    const res = await chatWithAgent(agentId!, mensaje, conversationId, "widget", undefined, true);
    conversationId = res.conversationId;
    // Todos los turnos del escenario comparten conversación; lo que se juzga es el ÚLTIMO
    // texto, y las herramientas que importan son las del último turno.
    reply = res.text;
    toolCalls = res.toolCalls ?? [];
    tokens += res.tokensUsed ?? 0;
  }
  return { reply, toolCalls, tokens };
}

function recortar(texto: string, max = 300): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length <= max ? limpio : `${limpio.slice(0, max)}…`;
}

async function correrRama(
  skill: string,
  indiceRepeticion: number,
  conSkill: boolean,
  skillId: string,
): Promise<Pasada> {
  const escenario = escenarioDe(skill);

  // Reemplazo declarativo: con la skill instalada el agente tiene EXACTAMENTE esa skill, para
  // que la diferencia entre las dos ramas sea la skill y nada más.
  await setAgentSkills(agentId!, conSkill ? [skillId] : []);

  const etiqueta = `${skill} · pasada ${indiceRepeticion}/${repeats} · ${conSkill ? "CON" : "SIN"}`;
  try {
    const { reply, toolCalls, tokens } = await conversar(escenario.messages);
    const veredicto = escenario.check(reply);
    return {
      skill,
      repeat: indiceRepeticion,
      conSkill,
      reply,
      pass: veredicto.pass,
      reasons: veredicto.reasons,
      llamado: calledUsarSkill(toolCalls, skill),
      tokens,
    };
  } catch (e) {
    // Un turno que revienta no se maquilla: se apunta como pasada fallida con su motivo y se
    // sigue. Si todos fallan, el veredicto saldrá NO CONCLUYENTE, que es la verdad.
    const mensaje = e instanceof Error ? e.message : String(e);
    console.error(`\n  ✗ ${etiqueta}: ${mensaje}`);
    return {
      skill,
      repeat: indiceRepeticion,
      conSkill,
      reply: "",
      pass: false,
      reasons: ["la llamada al modelo falló, no hay respuesta que juzgar"],
      llamado: false,
      tokens: 0,
      error: mensaje,
    };
  }
}

function tasa(pasadas: Pasada[]): number {
  if (pasadas.length === 0) return 0;
  return pasadas.filter((p) => p.pass).length / pasadas.length;
}

function media(numeros: number[]): number {
  if (numeros.length === 0) return 0;
  return Math.round(numeros.reduce((a, b) => a + b, 0) / numeros.length);
}

/**
 * El veredicto lo decide `skillVerdict` (en `skill-effect.ts`), porque es lo único del informe
 * que se puede probar sin base de datos, sin red y sin gastar una llamada al modelo.
 */
function veredicto(con: Pasada[], sin: Pasada[]): { veredicto: SkillVerdictValue; motivo: string } {
  return skillVerdict(con, sin);
}

function imprimirPasada(p: Pasada) {
  const marca = p.pass ? "✓ pasa" : "✗ falla";
  console.log(
    `\n──── ${p.skill} · pasada ${p.repeat}/${repeats} · ${p.conSkill ? "CON la skill" : "SIN la skill"} ────`,
  );
  console.log(
    `${marca} · usar_skill=${p.llamado ? "sí" : "no"} · ${p.tokens} tokens`,
  );
  for (const motivo of p.reasons) console.log(`  · ${motivo}`);
  console.log(`  «${recortar(p.reply) || "(respuesta vacía)"}»`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * main
 * ──────────────────────────────────────────────────────────────────────────── */

async function main() {
  if (!agentId) return inspeccionar();

  // Los escenarios son la lista de lo que se puede medir: pedir una skill sin escenario no
  // tiene criterio, y sin criterio el informe sería la opinión de quien lo lee.
  const sinEscenario = skillsSolicitadas.filter((s) => !scenarioForSkill(s));
  if (sinEscenario.length) {
    console.error(
      `Sin escenario para: ${sinEscenario.join(", ")}\n` +
        `Disponibles: ${SKILL_SCENARIOS.map((s) => s.skill).join(", ")}`,
    );
    return;
  }

  const overridesInvalidos = [...overridesEscenario.keys()].filter(
    (s) => !skillsSolicitadas.includes(s),
  );
  if (overridesInvalidos.length) {
    console.error(
      `--scenario para una skill que no se va a medir: ${overridesInvalidos.join(", ")}\n` +
        `Skills de esta pasada: ${skillsSolicitadas.join(", ")}`,
    );
    return;
  }

  const agente = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    select: {
      name: true,
      status: true,
      model: true,
      runtime: true,
      skills: { select: { skillId: true, skill: { select: { name: true } } } },
    },
  });

  // La guarda va ANTES de tocar nada: un agente publicado está atendiendo clientes reales, y
  // reemplazarle las skills, aunque sea un segundo y con restauración, es un riesgo que no se
  // asume por defecto.
  if (agente.status === "published" && !allowPublished) {
    console.error(
      `⛔ El agente "${agente.name}" está en estado published: es el que atiende clientes de verdad.\n` +
        `   Usa un agente en draft (o pasa --allow-published si de verdad es el sujeto de la prueba).`,
    );
    return;
  }

  foto = {
    agentId,
    skillIds: agente.skills.map((s) => s.skillId),
    skillNames: agente.skills
      .map((s) => s.skill?.name)
      .filter((n): n is string => Boolean(n)),
    model: agente.model,
    modeloCambiado: Boolean(modeloSolicitado) && modeloSolicitado !== agente.model,
  };

  console.log("──── Sujeto ────");
  console.log(`  agente: ${agente.name} (${agentId}) · estado ${agente.status} · runtime ${agente.runtime}`);
  console.log(`  skills instaladas ahora: ${foto.skillNames.join(", ") || "(ninguna)"}`);
  console.log(`  modelo en la base: ${agente.model}`);
  if (foto.modeloCambiado) {
    console.log(`  modelo de la prueba: ${modeloSolicitado} (se restaura al terminar)`);
  }
  if (modeloSolicitado && agente.runtime !== "openai") {
    console.log(
      `  ⚠ runtime "${agente.runtime}": el motor resuelve el modelo por el gateway y puede ignorar el override.`,
    );
  }
  console.log(`  pasadas por rama: ${repeats} · skills: ${skillsSolicitadas.join(", ")}`);
  for (const [skill, mensaje] of overridesEscenario) {
    console.log(`  mensaje de ${skill} (--scenario): «${recortar(mensaje, 160)}»`);
  }
  console.log(
    "  (cada rama usa una conversación de prueba nueva; el script no borra conversaciones)",
  );

  try {
    // El override de modelo se aplica UNA vez, antes de todo: `chatWithAgent` no acepta un
    // modelo por parámetro (lee `Agent.model` dentro de `runAgent`), así que la única forma de
    // probar otro modelo es cambiarlo y devolverlo. Se escribe con `prisma.agent.update` y no
    // con `updateAgent` a propósito: ese servicio sincroniza el aprovisionamiento de OpenClaw,
    // y un cambio temporal de modelo no debe provocar escrituras en el gateway.
    if (foto.modeloCambiado) {
      await prisma.agent.update({ where: { id: agentId }, data: { model: modeloSolicitado! } });
    }

    const informes: Array<{ skill: string; con: Pasada[]; sin: Pasada[] }> = [];

    for (const skill of skillsSolicitadas) {
      const fila = await prisma.skill.findUnique({
        where: { name: skill },
        select: { id: true, instructions: true, source: true },
      });
      if (!fila) {
        console.log(
          `\n⚠ La skill ${skill} no existe en esta base: no se puede instalar. ` +
            `¿Falta sembrar el catálogo (scripts/seed-builtin-skills.ts)?`,
        );
        informes.push({ skill, con: [], sin: [] });
        continue;
      }
      if (!fila.instructions || !fila.instructions.trim()) {
        // Sin cuerpo curado, `usar_skill` devuelve la descripción de una línea: el modelo no
        // llega a leer el protocolo y la medición no diría nada sobre la skill.
        console.log(
          `\n⚠ La skill ${skill} (source=${fila.source}) no tiene instrucciones en esta base: ` +
            `el cuerpo no llegará al modelo. Siembra el catálogo antes de medir.`,
        );
      }

      const con: Pasada[] = [];
      const sin: Pasada[] = [];

      for (let i = 1; i <= repeats; i++) {
        // Primero SIN, después CON: si el orden se invirtiera, la conversación "sin skill"
        // podría heredar el tono de la anterior en la caché del proveedor y ensuciar el A/B.
        const pasadaSin = await correrRama(skill, i, false, fila.id);
        imprimirPasada(pasadaSin);
        sin.push(pasadaSin);

        const pasadaCon = await correrRama(skill, i, true, fila.id);
        imprimirPasada(pasadaCon);
        con.push(pasadaCon);
      }

      informes.push({ skill, con, sin });
    }

    console.log("\n════════════════════ RESUMEN ════════════════════════");
    console.log(
      "skill".padEnd(34) +
        "sin-pass".padEnd(10) +
        "con-pass".padEnd(10) +
        "usar_skill".padEnd(12) +
        "tok sin/con".padEnd(14) +
        "veredicto",
    );
    for (const informe of informes) {
      const { con, sin } = informe;
      const v = veredicto(con, sin);
      const llamadas = con.length ? `${Math.round((con.filter((p) => p.llamado).length / con.length) * 100)}%` : "—";
      console.log(
        informe.skill.padEnd(34) +
          `${Math.round(tasa(sin) * 100)}%`.padEnd(10) +
          `${Math.round(tasa(con) * 100)}%`.padEnd(10) +
          llamadas.padEnd(12) +
          `${media(sin.map((p) => p.tokens))}/${media(con.map((p) => p.tokens))}`.padEnd(14) +
          v.veredicto,
      );
      console.log(`  └ ${v.motivo}`);
    }

    if (repeats < 3) {
      console.log(
        `\n⚠ n=${repeats} por rama. Con menos de 3 pasadas el porcentaje es una anécdota: no hay suficiente para distinguir "no se nota" de "ha salido mal una vez".`,
      );
    }
  } finally {
    await restaurar();
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await restaurar();
    await prisma.$disconnect();
  });
