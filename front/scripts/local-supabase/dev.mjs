/**
 * npm run dev:local (front) — starts Next against the local Supabase stack (aa-supabase-local S5).
 * Inline process env wins over every .env file in Next, so no .env file is read or written here.
 * Stack: the CRM's local Supabase (creador_CRM/back), overridable with LOCAL_SUPABASE_WORKDIR.
 */
import { execSync, spawn } from "node:child_process";
import path from "node:path";

const workdir = process.env.LOCAL_SUPABASE_WORKDIR ?? path.resolve(process.cwd(), "../../creador_CRM/back");
const shell = process.platform === "win32";

let output;
try {
  // Quoted: the repo path contains spaces ("22. Proyectos").
  output = execSync(`npx supabase status -o env --workdir "${workdir}"`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch {
  console.error(`✗ No se pudo leer el Supabase local en ${workdir}. Arráncalo con: npx supabase start --workdir "${workdir}"`);
  process.exit(1);
}

const vars = {};
for (const line of output.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m) vars[m[1]] = m[2];
}
if (!vars.API_URL || !vars.ANON_KEY) {
  console.error("✗ Faltan API_URL o ANON_KEY en supabase status");
  process.exit(1);
}
const host = new URL(vars.API_URL).hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
  console.error(`✗ El Supabase de ${workdir} no es local (host: ${host}); abortado.`);
  process.exit(1);
}

console.log(`→ Front contra Supabase LOCAL (${vars.API_URL}) y back http://localhost:4000`);
const child = spawn("npx", ["next", "dev"], {
  stdio: "inherit",
  shell,
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: vars.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: vars.ANON_KEY,
    NEXT_PUBLIC_API_URL: "http://localhost:4000",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
