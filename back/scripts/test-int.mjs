// Corre los tests de integración (Storage real) cargando .env ANTES de vitest,
// así supabaseAdmin se construye con credenciales reales y los describe.skipIf
// no se saltan. En CI sin .env, los tests siguen saltándose solos.
//   npm run test:int
import "dotenv/config";
import { spawnSync } from "node:child_process";

if (!process.env.SUPABASE_URL || process.env.SUPABASE_URL.includes("placeholder")) {
  console.error("⚠️  SUPABASE_URL real ausente — la integración se saltará. Revisa back/.env");
}

const r = spawnSync(
  "npx",
  ["vitest", "run", ...(process.argv.slice(2).length ? process.argv.slice(2) : ["tests/storage.test.ts"])],
  { stdio: "inherit", shell: true, env: process.env }
);
process.exit(r.status ?? 1);
