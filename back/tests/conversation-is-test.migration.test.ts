/**
 * T1.2 — aa-agente-consola-pruebas F1 (design.md §B.2).
 * Cubre: (1) el modelo `Conversation` declara `isTest` con el contrato del design
 * (Boolean @default(false) @map("es_prueba")); (2) la migración es ADITIVA (solo
 * ALTER TABLE ADD COLUMN sobre `conversacion`, sin DROP/DELETE/UPDATE/TRUNCATE ni
 * backfill — el DEFAULT false cubre las filas existentes → regresión cero).
 *
 * Patrón puro (regex sobre ficheros), sin BD real — mismo patrón que
 * lead-qualification.migration.test.ts / agent-data-backend.migration.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SCHEMA = readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf-8");
const MIGRATION = readFileSync(
  path.join(__dirname, "..", "prisma", "migrations", "20260717010000_conversation_is_test", "migration.sql"),
  "utf-8"
);

describe("schema: Conversation.isTest", () => {
  const model = SCHEMA.match(/model Conversation \{[\s\S]*?\n\}/)?.[0];

  it("existe y declara el contrato de design.md §B.2", () => {
    expect(model).toBeTruthy();
    expect(model).toMatch(/isTest\s+Boolean\s+@default\(false\)\s+@map\("es_prueba"\)/);
  });

  it("no toca ninguna otra columna existente del modelo (agentId/channel/etc. intactos)", () => {
    expect(model).toMatch(/agentId\s+String\s+@map\("agente_id"\)/);
    expect(model).toMatch(/channel\s+String\s+@default\("widget"\)\s+@map\("canal"\)/);
  });
});

describe("migración 20260717010000_conversation_is_test", () => {
  const sql = MIGRATION.replace(/^\s*--.*$/gm, "");

  it("agrega la columna nueva sobre la tabla conversacion existente", () => {
    expect(sql).toMatch(/ALTER TABLE "conversacion" ADD COLUMN "es_prueba" BOOLEAN NOT NULL DEFAULT false/);
  });

  it("es ADITIVA: sin DROP/DELETE/UPDATE/TRUNCATE, sin CREATE TABLE, sin backfill (INSERT)", () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/^\s*UPDATE\b/im);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bCREATE TABLE\b/i);
    expect(sql).not.toMatch(/\bINSERT INTO\b/i);
  });

  it("el único ALTER TABLE es sobre 'conversacion' (sin tocar otras tablas)", () => {
    const alters = sql.match(/ALTER TABLE\s+"([^"]+)"/gi) ?? [];
    expect(alters.length).toBeGreaterThan(0);
    for (const a of alters) expect(a).toContain('"conversacion"');
  });

  it("DEFAULT false cubre las filas existentes sin backfill explícito (regresión cero)", () => {
    expect(sql).toMatch(/DEFAULT false/);
  });
});
