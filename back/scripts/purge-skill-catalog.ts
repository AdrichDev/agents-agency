/**
 * aa-catalogo-skills-purga (T2) — Borra del catálogo las skills que no sirven a ningún
 * agente de cliente.
 *
 * Por qué un script y no un endpoint: `routes/skills.ts` no tiene DELETE, y no debe
 * tenerlo. Esto es una curación de catálogo que se hace una vez, con un humano delante y
 * con backup. Un endpoint de borrado en la API sería una superficie permanente para algo
 * que pasa una sola vez.
 *
 * Uso:
 *   npx tsx -r dotenv/config scripts/purge-skill-catalog.ts            # simulacro (por defecto)
 *   npx tsx -r dotenv/config scripts/purge-skill-catalog.ts --apply    # borra de verdad
 *
 * El simulacro es el modo por defecto a propósito: mismo patrón que
 * `scripts/delete-orphan-agents.ts`. Hay que teclear `--apply` para destruir algo.
 *
 * Para deshacer: `scripts/restore-skill-catalog.ts <fichero-de-backup>`.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { prisma } from "@/lib/db";
import { planSkillPurge, isPurgeSafe } from "@/lib/skills/purge-plan";
import { BUILTIN_SKILL_SOURCE } from "@/lib/skills/builtin-catalog";

const APPLY = process.argv.includes("--apply");
// Anclado al directorio desde el que se ejecuta (`back/`), NO a `__dirname`. Comprobado:
// bajo `tsx`, `__dirname` en este script resuelve a `src/lib/generated/prisma`, así que el
// backup acababa dentro del cliente Prisma generado — una carpeta que `prisma generate`
// rehace. El backup de un borrado de 105 filas no puede vivir donde una regeneración lo
// pisa.
const BACKUP_DIR = join(process.cwd(), "prisma", "backups");

/** Fecha en ISO corto para el nombre del backup. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const catalog = await prisma.skill.findMany({
    // `source` es obligatorio en el plan: sin él, las skills propias (`source: "builtin"`)
    // no se distinguen de las importadas y caen en `remove`.
    select: { id: true, name: true, source: true, _count: { select: { agents: true } } },
    orderBy: { name: "asc" },
  });

  const plan = planSkillPurge(
    catalog.map((s) => ({
      id: s.id,
      name: s.name,
      source: s.source,
      agentCount: s._count.agents,
    }))
  );

  const propias = plan.keep.filter((s) => s.source === BUILTIN_SKILL_SOURCE);

  console.log(`Catálogo: ${catalog.length} skills`);
  console.log(`  Se conservan: ${plan.keep.length}  (${propias.length} propias)`);
  console.log(`  Se borrarían: ${plan.remove.length}`);

  // ── Aborto 0: ni una skill propia en la lista de borrado ────────────────────
  // Redundante con `planSkillPurge`, y a propósito. Esto borra en producción y sin vuelta
  // atrás salvo backup; el día que alguien toque el plan, esta comprobación es la que
  // convierte el fallo en un aborto en vez de en diez skills perdidas.
  const propiasEnBorrado = plan.remove.filter((s) => s.source === BUILTIN_SKILL_SOURCE);
  if (propiasEnBorrado.length > 0) {
    console.error("\nABORTA: el plan quiere borrar skills PROPIAS. Eso es un fallo del plan:");
    for (const s of propiasEnBorrado) console.error(`  - ${s.name}`);
    process.exitCode = 1;
    return;
  }

  // ── Aborto 1: el catálogo no es el que se auditó ────────────────────────────
  // Si una de las conservadas no aparece por su nombre exacto, puede estar en la base con
  // otro nombre — y entonces su fila real está en `remove`. Parar aquí es obligatorio.
  if (plan.missing.length > 0) {
    console.error("\nABORTA: estas skills que había que CONSERVAR no están en el catálogo:");
    for (const name of plan.missing) console.error(`  - ${name}`);
    console.error("El catálogo no coincide con el que se auditó. No se borra nada.");
    process.exitCode = 1;
    return;
  }

  // ── Aborto 2: alguien la está usando ────────────────────────────────────────
  if (plan.installed.length > 0) {
    console.error("\nABORTA: estas skills a borrar están instaladas en algún agente:");
    for (const s of plan.installed) console.error(`  - ${s.name} (${s.agentCount} agente/s)`);
    console.error("Revisa la curación antes de seguir. No se borra nada.");
    process.exitCode = 1;
    return;
  }

  if (plan.remove.length === 0) {
    console.log("\nNada que borrar. El catálogo ya está curado.");
    return;
  }

  if (!APPLY) {
    console.log("\nSIMULACRO (sin --apply). Se borrarían:");
    for (const s of plan.remove) console.log(`  - ${s.name}`);
    console.log(`\nTotal: ${plan.remove.length}. Repite con --apply para ejecutarlo.`);
    return;
  }

  // ── Backup ANTES de tocar nada ──────────────────────────────────────────────
  // Se reeligen las filas COMPLETAS (no el `select` reducido de arriba): el backup tiene
  // que poder reconstruir la fila entera, incluidos `instructions`, `toolsProvider` y
  // `tools`. Un backup parcial es peor que ninguno, porque da falsa tranquilidad.
  const ids = plan.remove.map((s) => s.id);
  const full = await prisma.skill.findMany({ where: { id: { in: ids } } });
  if (full.length !== ids.length) {
    console.error(
      `ABORTA: el backup recuperó ${full.length} filas de ${ids.length}. No se borra nada.`
    );
    process.exitCode = 1;
    return;
  }

  const backupPath = join(BACKUP_DIR, `skills-${today()}.json`);
  mkdirSync(dirname(backupPath), { recursive: true });
  writeFileSync(backupPath, JSON.stringify(full, null, 2), "utf8");
  console.log(`\nBackup escrito: ${backupPath} (${full.length} filas)`);

  // Y se vuelve a leer del disco antes de borrar. Escribir un fichero no demuestra que el
  // fichero se pueda leer: la ruta puede haber ido a otro sitio del que se cree (ya pasó con
  // `__dirname`) y el JSON puede haber salido incompleto. Si el backup no se relee entero,
  // no hay camino de vuelta y no se borra nada.
  const releido = JSON.parse(readFileSync(backupPath, "utf8")) as Array<{ id: string }>;
  const idsBackup = new Set(releido.map((r) => r.id));
  if (releido.length !== ids.length || ids.some((id) => !idsBackup.has(id))) {
    console.error(
      `ABORTA: el backup releído no cuadra (${releido.length} de ${ids.length}). No se borra nada.`
    );
    process.exitCode = 1;
    return;
  }
  console.log("Backup releído y verificado.");

  // ── Borrado ─────────────────────────────────────────────────────────────────
  // La condición de seguridad se REVUELVE a comprobar dentro de la transacción: entre el
  // plan y el borrado alguien puede haber instalado una de estas skills en un agente.
  // Mismo patrón que `delete-orphan-agents.ts`.
  const deleted = await prisma.$transaction(async (tx) => {
    const stillInstalled = await tx.agentSkill.count({ where: { skillId: { in: ids } } });
    if (stillInstalled > 0) {
      throw new Error(
        `Alguien instaló una de estas skills mientras corría el script (${stillInstalled} instalaciones). Abortado sin borrar.`
      );
    }
    const res = await tx.skill.deleteMany({ where: { id: { in: ids } } });
    return res.count;
  });

  console.log(`Borradas: ${deleted} skills. Quedan ${plan.keep.length} en el catálogo.`);
  console.log(`Para deshacer: npx tsx -r dotenv/config scripts/restore-skill-catalog.ts ${backupPath}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
