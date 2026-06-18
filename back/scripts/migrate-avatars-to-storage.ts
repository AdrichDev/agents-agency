import "dotenv/config";
import { prisma } from "@/lib/db";
import { uploadImageDataUrl } from "@/lib/storage";

/**
 * Migra avatares de widget de base64 (legacy) a Supabase Storage.
 * Para cada Agent con widgetAvatarBase64 y SIN widgetAvatarUrl: sube la imagen y
 * deja la URL, limpiando el base64. Idempotente (los ya migrados se saltan).
 *
 *   npx tsx scripts/migrate-avatars-to-storage.ts          # DRY-RUN (no escribe)
 *   npx tsx scripts/migrate-avatars-to-storage.ts --apply  # aplica los cambios
 *
 * Nota: las imágenes de landing (back/public/landing-assets) NO se migran aquí —
 * sus URLs están embebidas en el HTML generado; migrarlas es un find/replace
 * frágil. Mientras: se sirven desde disco (persistir ese volumen en prod) y solo
 * las imágenes NUEVAS van a Storage.
 */
const APPLY = process.argv.includes("--apply");

async function main() {
  const agents = await prisma.agent.findMany({
    where: { widgetAvatarBase64: { not: null }, widgetAvatarUrl: null },
    select: { id: true, widgetAvatarBase64: true },
  });
  console.log(`${agents.length} agente(s) con avatar base64 sin migrar.`);
  if (!APPLY) console.log("(DRY-RUN — usa --apply para escribir)\n");

  let ok = 0;
  let fail = 0;
  for (const a of agents) {
    const b64 = a.widgetAvatarBase64!;
    if (!APPLY) {
      console.log(`  [dry] agente ${a.id} → subiría widget-avatars/${a.id}.webp`);
      continue;
    }
    try {
      const url = await uploadImageDataUrl(`widget-avatars/${a.id}.webp`, b64);
      await prisma.agent.update({
        where: { id: a.id },
        data: { widgetAvatarUrl: url, widgetAvatarBase64: null },
      });
      console.log(`  ✓ ${a.id} → ${url}`);
      ok++;
    } catch (e: any) {
      console.log(`  ✗ ${a.id} → ${e?.message ?? e}`);
      fail++;
    }
  }
  if (APPLY) console.log(`\nHecho: ${ok} migrados, ${fail} fallidos.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
