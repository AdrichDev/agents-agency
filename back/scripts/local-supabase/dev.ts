/**
 * npm run dev:local (back) — starts the back against the local Supabase stack (aa-supabase-local S5).
 * Only the database and Supabase keys are overridden in the child process env; everything else
 * (LLM keys, n8n, ...) still comes from back/.env. No .env file is read or written here.
 */
import { spawn } from "node:child_process";
import { localBackEnv, readLocalStack } from "./lib";

const stack = readLocalStack();
const overrides = localBackEnv(stack);
console.log(`→ Back contra Supabase LOCAL (${stack.apiUrl}, base agents_agency)`);

const child = spawn("npx", ["tsx", "watch", "src/index.ts"], {
  stdio: "inherit",
  env: { ...process.env, ...overrides },
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 0));
