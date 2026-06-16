#!/usr/bin/env node
/**
 * backup-db.mjs — Dump automático de la base de datos vía Docker.
 *
 * Usa pg_dump en formato custom (-Fc) dentro del contenedor agent-agency-db.
 * Guarda en back/backups/ con timestamp y rota manteniendo los últimos N.
 *
 * Uso manual:   npm run backup
 * Programado:   Tarea de Windows (ver scripts/register-backup-task.ps1)
 *
 * Restaurar un dump:
 *   docker exec -i agent-agency-db pg_restore -U postgres -d 3AStudioDB --clean --if-exists < back/backups/<archivo>.dump
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = join(__dirname, "..", "backups");

const CONTAINER = process.env.BACKUP_DB_CONTAINER ?? "agent-agency-db";
const DB_NAME = process.env.BACKUP_DB_NAME ?? "3AStudioDB";
const DB_USER = process.env.BACKUP_DB_USER ?? "postgres";
const KEEP = Number(process.env.BACKUP_KEEP ?? 14); // nº de dumps a conservar

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
  const outPath = join(BACKUP_DIR, `${DB_NAME}-${timestamp()}.dump`);

  console.log(`[backup] pg_dump ${DB_NAME} desde contenedor ${CONTAINER}...`);

  // pg_dump -Fc escribe a stdout; capturamos el buffer y lo guardamos síncrono.
  const dump = execFileSync(
    "docker",
    ["exec", CONTAINER, "pg_dump", "-U", DB_USER, "-Fc", DB_NAME],
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
