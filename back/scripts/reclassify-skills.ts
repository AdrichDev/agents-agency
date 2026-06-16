/**
 * reclassify-skills.ts — Reclasifica type/use de skills mal etiquetados.
 *
 * Tras la restauración del volumen antiguo, los 100 skills quedaron como
 * SKILL/GENERAL (el schema viejo no tenía type/use). Este script reaplica la
 * lógica de clasificación existente (detectType/detectUse) usando nombre +
 * descripción + repoUrl como señales.
 *
 * Por defecto solo toca los que están en SKILL/GENERAL (no pisa clasificaciones
 * manuales). Con FORCE=1 reclasifica todos.
 *
 * Ejecutar: npx tsx scripts/reclassify-skills.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { detectType, detectUse } from "@/lib/github-skills/scraper-parts/classification";

async function main() {
  const force = process.env.FORCE === "1";
  const skills = await prisma.skill.findMany();

  let changed = 0;
  const tally: Record<string, number> = {};

  for (const s of skills) {
    // Solo reclasificar los no clasificados, salvo FORCE
    if (!force && s.type !== "SKILL" && s.use !== "GENERAL") continue;

    // Señal extra: el repoUrl suele contener "mcp", "agent", etc.
    const extra = s.repoUrl ?? "";
    const newType = detectType(s.name, s.description ?? "", extra);
    const newUse = detectUse(s.name, s.description ?? "", extra);

    if (newType !== s.type || newUse !== s.use) {
      await prisma.skill.update({ where: { id: s.id }, data: { type: newType, use: newUse } });
      changed++;
    }
    tally[newType] = (tally[newType] ?? 0) + 1;
  }

  console.log(`[reclassify] Skills actualizados: ${changed}/${skills.length}`);
  console.log(`[reclassify] Distribución por type:`, JSON.stringify(tally));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[reclassify] ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
