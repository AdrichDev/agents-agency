/**
 * Shared helpers for the local Supabase workflow (odd/tasks/aa-supabase-local.md).
 *
 * The local stack is the CRM's (creador_CRM/back/supabase, project_id test_crm). AA keeps its
 * tables in a dedicated database `agents_agency` on that same Postgres, schema `aa`, and uses
 * the shared Auth and Storage through their HTTP API.
 */
import { execSync } from "node:child_process";
import path from "node:path";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export const LOCAL_DB_NAME = "agents_agency";
export const LOCAL_DB_SCHEMA = "aa";
export const LOCAL_ADMIN_EMAIL = "admin@aa.local";
export const LOCAL_ADMIN_PASSWORD = "admin-local-1234";

/**
 * S4: única puerta antes de tocar una base. Lanza si el host no es local. El mensaje nombra el
 * host pero nunca la URL completa, para no filtrar contraseñas.
 */
export function assertLocalDatabaseUrl(url: string): void {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("La URL de base de datos no es local (URL vacía o mal formada); abortado.");
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`La base de datos no es local (host: ${host}); abortado para no tocar producción.`);
  }
}

export interface LocalStack {
  apiUrl: string;
  dbUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  studioUrl: string;
}

/** Workdir of the shared stack: env LOCAL_SUPABASE_WORKDIR or ../../creador_CRM/back from back/. */
export function stackWorkdir(backDir = process.cwd()): string {
  return process.env.LOCAL_SUPABASE_WORKDIR ?? path.resolve(backDir, "../../creador_CRM/back");
}

/** Quotes one shell argument (the repo path contains spaces: "22. Proyectos"). */
export function shellQuote(arg: string): string {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/** Parses `supabase status -o env` output (KEY="value" lines). */
export function parseStatusEnv(output: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

/** Reads the running local stack. Fails with a clear hint when it is not started. */
export function readLocalStack(workdir = stackWorkdir()): LocalStack {
  let output: string;
  try {
    output = execSync(`npx supabase status -o env --workdir ${shellQuote(workdir)}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      `No se pudo leer el Supabase local en ${workdir}. Arráncalo con: npx supabase start --workdir "${workdir}"`
    );
  }
  const v = parseStatusEnv(output);
  const required = ["API_URL", "DB_URL", "ANON_KEY", "SERVICE_ROLE_KEY"] as const;
  const missing = required.filter((k) => !v[k]);
  if (missing.length) throw new Error(`Faltan valores en supabase status: ${missing.join(", ")}`);
  assertLocalDatabaseUrl(v.DB_URL);
  return {
    apiUrl: v.API_URL,
    dbUrl: v.DB_URL,
    anonKey: v.ANON_KEY,
    serviceRoleKey: v.SERVICE_ROLE_KEY,
    studioUrl: v.STUDIO_URL ?? "",
  };
}

/** URL of the AA database on the shared server (same credentials, dedicated database). */
export function aaDatabaseUrl(stack: LocalStack, opts: { forMigrate?: boolean } = {}): string {
  const url = new URL(stack.dbUrl);
  url.pathname = `/${LOCAL_DB_NAME}`;
  if (opts.forMigrate) url.searchParams.set("schema", LOCAL_DB_SCHEMA);
  const result = url.toString();
  assertLocalDatabaseUrl(result);
  return result;
}

/** Env overrides for the back when running against the local stack. */
export function localBackEnv(stack: LocalStack): Record<string, string> {
  return {
    DATABASE_URL: aaDatabaseUrl(stack),
    DB_SCHEMA: LOCAL_DB_SCHEMA,
    SUPABASE_URL: stack.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: stack.serviceRoleKey,
  };
}
