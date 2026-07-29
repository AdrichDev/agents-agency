/**
 * aa-skills-propias-tenant (T2) — Siembra las skills escritas por nosotros.
 *
 * Uso:
 *   npx tsx -r dotenv/config scripts/seed-builtin-skills.ts            # simulacro (por defecto)
 *   npx tsx -r dotenv/config scripts/seed-builtin-skills.ts --apply    # escribe en la base
 *
 * Simulacro por defecto, igual que `purge-skill-catalog.ts`: esto escribe en el catálogo de
 * producción y lo que escribe es lo que el agente de un cliente va a decirle a la gente.
 *
 * Idempotente: `create` si no existe, `update` si ya es nuestra. Nunca toca una fila que no
 * tenga `source: "builtin"` — si un nombre nuestro estuviera ocupado por una skill importada,
 * aborta sin escribir nada. Sobrescribirla sería un borrado disfrazado de actualización.
 *
 * No instala nada en ningún agente (design.md AD5). Crear el catálogo y decidir qué agente
 * lleva qué skill son decisiones distintas, y la segunda es del operador.
 */
import { prisma } from "@/lib/db";
import {
  BUILTIN_SKILLS,
  BUILTIN_SKILL_SOURCE,
  planBuiltinSeed,
  isSeedSafe,
} from "@/lib/skills/builtin-catalog";

const APPLY = process.argv.includes("--apply");

async function main() {
  const names = BUILTIN_SKILLS.map((s) => s.name);

  // Sólo se consultan los nombres nuestros: el resto del catálogo no pinta nada aquí y no
  // hay razón para traérselo.
  const existing = await prisma.skill.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true, source: true },
  });

  const plan = planBuiltinSeed(existing);

  console.log(`Skills propias definidas: ${BUILTIN_SKILLS.length}`);
  console.log(`  Se crearían:     ${plan.create.length}`);
  console.log(`  Se actualizarían: ${plan.update.length}`);

  // ── Aborto: un nombre nuestro ocupado por una fila ajena ────────────────────
  if (!isSeedSafe(plan)) {
    console.error("\nABORTA: estos nombres ya existen y NO son skills propias:");
    for (const c of plan.conflicts) console.error(`  - ${c.name} (source: ${c.source})`);
    console.error("Actualizarlas sería pisar una skill del catálogo importado. No se escribe nada.");
    process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    for (const s of plan.create) console.log(`  + ${s.name}  [${s.use}]`);
    for (const u of plan.update) console.log(`  ~ ${u.skill.name}  [${u.skill.use}]`);
    console.log("\nSIMULACRO (sin --apply). Repite con --apply para escribir.");
    return;
  }

  const now = new Date();

  // Una transacción para todo: un catálogo a medio sembrar es peor que uno sin sembrar,
  // porque el siguiente que lo mire no sabe qué versión está viendo.
  await prisma.$transaction(async (tx) => {
    for (const s of plan.create) {
      await tx.skill.create({
        data: {
          name: s.name,
          description: s.description,
          use: s.use,
          instructions: s.instructions,
          instructionsUpdatedAt: now,
          source: BUILTIN_SKILL_SOURCE,
          // `toolsProvider` y `mcpUrl` se dejan a null a propósito (design.md AD1): sin la
          // integración física conectada, declararlos sólo consigue un badge
          // "requiere conexión" que promete una facultad inexistente.
        } as never,
      });
    }

    for (const u of plan.update) {
      await tx.skill.update({
        where: { id: u.id },
        data: {
          description: u.skill.description,
          use: u.skill.use,
          instructions: u.skill.instructions,
          instructionsUpdatedAt: now,
        } as never,
      });
    }
  });

  const total = await prisma.skill.count({ where: { source: BUILTIN_SKILL_SOURCE } as never });
  console.log(
    `\nHecho. Creadas ${plan.create.length}, actualizadas ${plan.update.length}. ` +
      `Skills propias en el catálogo: ${total}.`
  );
  console.log(
    "Recuerda: esto NO instala nada. Para que se note, instala la skill en un agente desde su ficha."
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
