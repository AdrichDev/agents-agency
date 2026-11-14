/**
 * npm run db:local:setup — prepares the local database for agents-agency (aa-supabase-local S3).
 * Idempotent: safe to run again after pulling new migrations.
 *
 *  1. Creates database `agents_agency` on the shared local Postgres (search_path aa, public).
 *  2. Runs `prisma migrate deploy` against it (history stays in schema `aa`).
 *  3. Creates the Storage buckets (`public-assets`, private `kb-files`) via setup-storage-bucket.ts.
 *  4. Creates or updates the local admin login (Supabase Auth user + app user with role admin).
 *
 * Every database URL goes through assertLocalDatabaseUrl (S4) before it is used.
 */
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  LOCAL_ADMIN_EMAIL,
  LOCAL_ADMIN_PASSWORD,
  LOCAL_DB_NAME,
  LOCAL_DB_SCHEMA,
  aaDatabaseUrl,
  assertLocalDatabaseUrl,
  readLocalStack,
} from "./lib";

async function ensureDatabase(serverUrl: string): Promise<void> {
  assertLocalDatabaseUrl(serverUrl);
  const client = new Client({ connectionString: serverUrl });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [LOCAL_DB_NAME]);
    if (!rowCount) {
      await client.query(`CREATE DATABASE "${LOCAL_DB_NAME}"`);
      console.log(`✓ Base de datos ${LOCAL_DB_NAME} creada`);
    } else {
      console.log(`✓ Base de datos ${LOCAL_DB_NAME} ya existía`);
    }
    await client.query(`ALTER DATABASE "${LOCAL_DB_NAME}" SET search_path = ${LOCAL_DB_SCHEMA}, public`);
  } finally {
    await client.end();
  }
}

function migrate(migrateUrl: string): void {
  assertLocalDatabaseUrl(migrateUrl);
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: migrateUrl },
    shell: process.platform === "win32",
  });
  console.log("✓ Migraciones aplicadas");
}

/** Reuses the canonical bucket script (public-assets + kb-files) with the local stack keys. */
function ensureBuckets(apiUrl: string, serviceRoleKey: string): void {
  assertLocalDatabaseUrl(apiUrl);
  execFileSync("npx", ["tsx", "scripts/setup-storage-bucket.ts"], {
    stdio: "inherit",
    env: { ...process.env, SUPABASE_URL: apiUrl, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey },
    shell: process.platform === "win32",
  });
  console.log("✓ Buckets de Storage listos (public-assets, kb-files)");
}

async function ensureAdmin(apiUrl: string, serviceRoleKey: string, dbUrl: string): Promise<void> {
  const supabase = createClient(apiUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw new Error(`No se pudo listar usuarios de Auth: ${listError.message}`);
  let user = list.users.find((u) => u.email === LOCAL_ADMIN_EMAIL);
  if (user) {
    await supabase.auth.admin.updateUserById(user.id, { password: LOCAL_ADMIN_PASSWORD, email_confirm: true });
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: LOCAL_ADMIN_EMAIL,
      password: LOCAL_ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`No se pudo crear el admin local: ${error?.message}`);
    user = data.user;
  }

  assertLocalDatabaseUrl(dbUrl);
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO ${LOCAL_DB_SCHEMA}.usuario (id, nombre, apellido, email, rol, creado_en, actualizado_en)
       VALUES ($1, 'Admin', 'Local', $2, 'admin', now(), now())
       ON CONFLICT (email) DO UPDATE SET id = EXCLUDED.id, rol = 'admin', actualizado_en = now()`,
      [user.id, LOCAL_ADMIN_EMAIL]
    );
  } finally {
    await client.end();
  }
  console.log(`✓ Admin local listo: ${LOCAL_ADMIN_EMAIL} / ${LOCAL_ADMIN_PASSWORD}`);
}

async function main(): Promise<void> {
  const stack = readLocalStack();
  await ensureDatabase(stack.dbUrl);
  migrate(aaDatabaseUrl(stack, { forMigrate: true }));
  ensureBuckets(stack.apiUrl, stack.serviceRoleKey);
  await ensureAdmin(stack.apiUrl, stack.serviceRoleKey, aaDatabaseUrl(stack));
  console.log(`\nListo. Studio: ${stack.studioUrl}  ·  Back: npm run dev:local  ·  Front: npm run dev:local`);
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
