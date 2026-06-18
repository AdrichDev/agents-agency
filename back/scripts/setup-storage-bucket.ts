import "dotenv/config";
import { supabaseAdmin } from "@/lib/auth";

/**
 * Crea (idempotente) el bucket público `public-assets` para imágenes servidas en
 * páginas públicas (avatares de widget, imágenes de landing). Reejecutable.
 *
 *   npx tsx scripts/setup-storage-bucket.ts
 */
const BUCKET = "public-assets";

async function main() {
  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
  if (listErr) throw listErr;

  const exists = buckets?.some((b) => b.name === BUCKET);
  if (exists) {
    console.log(`bucket "${BUCKET}" ya existe → ok`);
  } else {
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
      public: true,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      fileSizeLimit: "2MB",
    });
    if (error) throw error;
    console.log(`bucket "${BUCKET}" creado (público, png/jpeg/webp, 2MB)`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERROR:", e.message ?? e); process.exit(1); });
