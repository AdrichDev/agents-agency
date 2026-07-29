/**
 * aa-catalogo-skills-purga (T4) — Deshace la purga desde un fichero de backup.
 *
 * Existe y se prueba ANTES de ejecutar el borrado. Un plan de vuelta atrás que no se ha
 * ejecutado nunca no es un plan de vuelta atrás: es una intención.
 *
 * Uso:
 *   npx tsx -r dotenv/config scripts/restore-skill-catalog.ts prisma/backups/skills-2026-07-28.json
 *   npx tsx -r dotenv/config scripts/restore-skill-catalog.ts <fichero> --apply
 *
 * Restaura con los MISMOS `id` que tenían. Las que ya existan (por nombre o por id) se
 * saltan: restaurar es reponer lo que falta, nunca pisar lo que hay.
 */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";

const args = process.argv.slice(2).filter((a) => a !== "--apply");
const APPLY = process.argv.includes("--apply");
const file = args[0];

async function main() {
  if (!file) {
    console.error("Falta el fichero de backup.");
    console.error("Uso: npx tsx -r dotenv/config scripts/restore-skill-catalog.ts <fichero> [--apply]");
    process.exitCode = 1;
    return;
  }

  const rows = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>[];
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error("El backup está vacío o no es una lista.");
    process.exitCode = 1;
    return;
  }
  console.log(`Backup: ${rows.length} filas (${file})`);

  const ids = rows.map((r) => String(r.id));
  const names = rows.map((r) => String(r.name));
  const existing = await prisma.skill.findMany({
    where: { OR: [{ id: { in: ids } }, { name: { in: names } }] },
    select: { id: true, name: true },
  });
  const takenIds = new Set(existing.map((e) => e.id));
  const takenNames = new Set(existing.map((e) => e.name));

  const toRestore = rows.filter(
    (r) => !takenIds.has(String(r.id)) && !takenNames.has(String(r.name))
  );

  console.log(`  Ya presentes (se saltan): ${rows.length - toRestore.length}`);
  console.log(`  Se restaurarían: ${toRestore.length}`);

  if (toRestore.length === 0) {
    console.log("Nada que restaurar.");
    return;
  }

  if (!APPLY) {
    for (const r of toRestore.slice(0, 20)) console.log(`  - ${String(r.name)}`);
    if (toRestore.length > 20) console.log(`  ... y ${toRestore.length - 20} más`);
    console.log("\nSIMULACRO (sin --apply). Repite con --apply para restaurar.");
    return;
  }

  // `createMany` con las filas tal cual salieron: las fechas vuelven como cadenas ISO del
  // JSON y Prisma las acepta. `skipDuplicates` es un cinturón sobre el filtro de arriba.
  const res = await prisma.skill.createMany({
    data: toRestore as never,
    skipDuplicates: true,
  });
  console.log(`Restauradas: ${res.count} skills.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
