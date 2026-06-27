#!/usr/bin/env node
/**
 * backup-db.mjs — Dump suplementario del schema `aa` desde Supabase.
 *
 * Tras la migración a Supabase ya NO hay Postgres local (se retiró el contenedor
 * agent-agency-db). Este script hace un pg_dump del schema `aa` directamente
 * contra la conexión de Supabase (DATABASE_URL de back/.env) y rota los últimos N.
 *
 * NOTA: Supabase ya hace backups gestionados a nivel de proyecto. Este dump es
 * SUPLEMENTARIO (copia off-site / portable, solo el schema de agents-agency).
 *
 * pg_dump se ejecuta EFÍMERO vía Docker (imagen postgres:17) para no depender de
 * tener el cliente instalado en el host y para fijar la versión (el servidor
 * Supabase es PG17 → el cliente debe ser >= 17). Requiere Docker en marcha.
 *
 * Requisitos:
 *   - Docker disponible (la imagen postgres:17 se descarga la primera vez).
 *   - DATABASE_URL apunta al session pooler (:5432) — pg_dump NO funciona sobre el
 *     transaction pooler (:6543).
 *
 * Uso manual:   npm run backup
 * Programado:   Tarea de Windows (ver scripts/register-backup-task.ps1)
 *
 * Restaurar un dump:
 *   docker run --rm -i postgres:17 pg_restore --no-owner --no-privileges \
 *     --clean --if-exists -n aa -d "<DATABASE_URL_SIN_PARAMS>" < back/backups/<archivo>.dump
 */
import { config as loadEnv } from "dotenv";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// .env por ruta ABSOLUTA (no relativa al cwd): la tarea programada ejecuta
// `node backup-db.mjs` sin working directory → un dotenv cwd-relativo fallaría.
loadEnv({ path: join(__dirname, "..", ".env") });
const BACKUP_DIR = join(__dirname, "..", "backups");

const SCHEMA = process.env.BACKUP_SCHEMA ?? "aa";
const KEEP = Number(process.env.BACKUP_KEEP ?? 14); // nº de dumps a conservar
const PGDUMP_IMAGE = process.env.BACKUP_PGDUMP_IMAGE ?? "postgres:17"; // >= versión del servidor

/** Conexión para pg_dump: DATABASE_URL sin los query params (p.ej. ?schema=aa,
 *  que es de Prisma y pg_dump no entiende). El schema se elige con -n. */
function connString() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no definida (revisa back/.env).");
  return url.split("?")[0];
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // 2026-06-16T09-30-00
}

function rotate() {
  const dumps = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".dump"))
    .map((f) => ({ f, t: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t); // más reciente primero

  for (const { f } of dumps.slice(KEEP)) {
    unlinkSync(join(BACKUP_DIR, f));
    console.log(`[backup] Rotado (borrado antiguo): ${f}`);
  }
}

function main() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const conn = connString();
  const outPath = join(BACKUP_DIR, `${SCHEMA}-${timestamp()}.dump`);

  console.log(`[backup] pg_dump schema "${SCHEMA}" desde Supabase (vía ${PGDUMP_IMAGE})...`);

  // pg_dump -Fc escribe a stdout; capturamos el buffer y lo guardamos síncrono.
  // --no-owner / --no-privileges → restaurable en otro proyecto sin chocar con roles.
  // Se corre dentro de un contenedor efímero (--rm) para fijar la versión del cliente.
  const dump = execFileSync(
    "docker",
    ["run", "--rm", PGDUMP_IMAGE, "pg_dump", conn, "-Fc", "-n", SCHEMA, "--no-owner", "--no-privileges"],
    { maxBuffer: 1024 * 1024 * 512 } // 512MB por si el dump crece
  );
  writeFileSync(outPath, dump);

  const sizeMb = (dump.length / 1024 / 1024).toFixed(2);
  console.log(`[backup] OK → ${outPath} (${sizeMb} MB)`);

  rotate();
  console.log(`[backup] Conservando últimos ${KEEP} dumps.`);
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error("[backup] ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
}
