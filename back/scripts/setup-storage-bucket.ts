import "dotenv/config";
import { supabaseAdmin } from "@/lib/auth";
import { PUBLIC_ASSETS_BUCKET, KB_FILES_BUCKET } from "@/lib/storage";

/**
 * Crea (idempotente) los buckets de Storage de la plataforma. Reejecutable.
 *
 *   npx tsx scripts/setup-storage-bucket.ts
 *
 * - `public-assets` (público): imágenes servidas en páginas anónimas
 *   (avatares de widget, imágenes de landing).
 * - `kb-files` (PRIVADO): originales de la base de conocimiento
 *   (aa-agent-backend-foundation F5, AC7). Solo el back (service role)
 *   lee/escribe; sin URL pública.
 */

interface BucketSpec {
  name: string;
  options: { public: boolean; allowedMimeTypes?: string[]; fileSizeLimit?: string };
  describe: string;
}

const BUCKETS: BucketSpec[] = [
  {
    name: PUBLIC_ASSETS_BUCKET,
    options: {
      public: true,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      fileSizeLimit: "2MB",
    },
    describe: "público, png/jpeg/webp, 2MB",
  },
  {
    name: KB_FILES_BUCKET,
    // 20MB = límite del upload de conocimiento (multer, routes/knowledge.ts).
    // Sin allowedMimeTypes: acepta pdf/docx/txt/md/html/csv/zip.
    options: { public: false, fileSizeLimit: "20MB" },
    describe: "PRIVADO, originales de conocimiento, 20MB",
  },
];

async function main() {
  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
  if (listErr) throw listErr;

  for (const spec of BUCKETS) {
    const exists = buckets?.some((b) => b.name === spec.name);
    if (exists) {
      console.log(`bucket "${spec.name}" ya existe → ok`);
      continue;
    }
    const { error } = await supabaseAdmin.storage.createBucket(spec.name, spec.options);
    if (error) throw error;
    console.log(`bucket "${spec.name}" creado (${spec.describe})`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERROR:", e.message ?? e); process.exit(1); });
