/**
 * T2.1 — aa-agent-external-crm-and-lead-qualification F2 (design.md §C.1).
 * Cubre: (1) el modelo `Lead` declara `qualification`/`qualificationReason`
 * con el contrato del design; (2) la migración es ADITIVA (solo ALTER TABLE
 * ADD COLUMN sobre `lead`, sin DROP/DELETE/UPDATE/TRUNCATE ni backfill —
 * el DEFAULT cubre las filas existentes).
 *
 * Patrón puro (regex sobre ficheros), sin BD real — mismo patrón que
 * agent-data-backend.migration.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SCHEMA = readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf-8");
const MIGRATION = readFileSync(
  path.join(__dirname, "..", "prisma", "migrations", "20260717000000_lead_qualification", "migration.sql"),
  "utf-8"
);

describe("schema: Lead.qualification / qualificationReason", () => {
  const model = SCHEMA.match(/model Lead \{[\s\S]*?\n\}/)?.[0];

  it("existe y declara el contrato de design.md §C.1", () => {
    expect(model).toBeTruthy();
    expect(model).toMatch(/qualification\s+String\s+@default\("unknown"\)\s+@map\("calificacion"\)/);
    expect(model).toMatch(/qualificationReason\s+String\?\s+@map\("motivo_calificacion"\)/);
  });

  it("no toca ninguna otra columna existente del modelo (customerName/status/etc. intactos)", () => {
    expect(model).toMatch(/customerName\s+String\s+@map\("nombre_cliente"\)/);
    expect(model).toMatch(/status\s+String\s+@default\("new"\)\s+@map\("estado"\)/);
  });
});

describe("migración 20260717000000_lead_qualification", () => {
  const sql = MIGRATION.replace(/^\s*--.*$/gm, "");

  it("agrega las 2 columnas nuevas sobre la tabla lead existente", () => {
    expect(sql).toMatch(/ALTER TABLE "lead" ADD COLUMN "calificacion" TEXT NOT NULL DEFAULT 'unknown'/);
    expect(sql).toMatch(/ALTER TABLE "lead" ADD COLUMN "motivo_calificacion" TEXT/);
  });

  it("es ADITIVA: sin DROP/DELETE/UPDATE/TRUNCATE, sin CREATE TABLE, sin backfill (INSERT)", () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/^\s*UPDATE\b/im);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bCREATE TABLE\b/i);
    expect(sql).not.toMatch(/\bINSERT INTO\b/i);
  });

  it("los únicos ALTER TABLE son sobre 'lead' (sin tocar otras tablas)", () => {
    const alters = sql.match(/ALTER TABLE\s+"([^"]+)"/gi) ?? [];
    expect(alters.length).toBeGreaterThan(0);
    for (const a of alters) expect(a).toContain('"lead"');
  });

  it("DEFAULT 'unknown' cubre las filas existentes sin backfill explícito", () => {
    expect(sql).toMatch(/DEFAULT 'unknown'/);
  });
});
