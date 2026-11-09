/**
 * S5 (responses-api-migration, T2) — `gpt-4.1-nano` sale del catálogo.
 *
 * OpenAI retiró el modelo (404 "The model gpt-4.1-nano has been deprecated"), así que tenerlo en el
 * catálogo no es "una opción más": es ofrecer a los clientes un agente que no responde. El catálogo
 * del back es la allowlist real de la generación IA (`routes/ai.ts`: `ALLOWED_GEN_MODELS =
 * new Set(KNOWN_MODEL_IDS)`), así que lo que se prueba aquí es la superficie con la que el resto
 * del sistema decide qué modelo es servible.
 *
 * El front es otro paquete y no se puede importar, pero su catálogo sí se puede leer (mismo recurso
 * que `cupo-defecto-front-back-coherencia.test.ts`): un selector que ofrece un modelo retirado es
 * la misma promesa incumplida vista desde el otro lado.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CACHED_TOKEN_RATIO,
  KNOWN_MODEL_IDS,
  MODEL_CAPABILITIES,
  capsFor,
} from "@/lib/model-capabilities";

const RAIZ = path.join(__dirname, "..");
const SCHEMA = readFileSync(path.join(RAIZ, "prisma", "schema.prisma"), "utf-8");
const FRONT_MODELS = readFileSync(path.join(RAIZ, "..", "front", "lib", "models.ts"), "utf-8");
/**
 * La migración se lee dentro de cada test, no al importar el módulo: si se leyera arriba, un fichero
 * que falta tumbaría el fichero entero y las demás reglas de S5 se quedarían sin veredicto propio.
 */
function migracion(): string {
  return readFileSync(
    path.join(RAIZ, "prisma", "migrations", "20261110090000_retire_gpt_4_1_nano", "migration.sql"),
    "utf-8"
  );
}

/** Bloque `model X { … }` del schema, tal cual. */
function bloqueDelSchema(modelo: string): string {
  const bloque = SCHEMA.match(new RegExp(`model ${modelo} \\{[\\s\\S]*?\\n\\}`))?.[0];
  if (!bloque) throw new Error(`El schema no declara el modelo ${modelo}`);
  return bloque;
}

describe("catálogo del back — gpt-4.1-nano ya no es un modelo servible", () => {
  it("no está en la lista de modelos conocidos (la allowlist de la generación IA)", () => {
    expect(KNOWN_MODEL_IDS).not.toContain("gpt-4.1-nano");
  });

  it("no tiene entrada en la tabla de capacidades ni ratio de caché", () => {
    expect(MODEL_CAPABILITIES).not.toHaveProperty("gpt-4.1-nano");
    expect(CACHED_TOKEN_RATIO).not.toHaveProperty("gpt-4.1-nano");
    // Un id desconocido no manda effort ni cambia de endpoint: así se comporta el motor con él.
    expect(capsFor("gpt-4.1-nano")).toEqual({ efforts: [], defaultEffort: null });
  });

  it("el resto del catálogo de OpenAI sigue ahí (no se llevó nada por delante)", () => {
    for (const id of ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "gpt-5.4-mini"]) {
      expect(KNOWN_MODEL_IDS, `${id} desapareció del catálogo`).toContain(id);
    }
  });

  it("luna conserva el effort por defecto del back (`low`, S3)", () => {
    expect(capsFor("gpt-5.6-luna").defaultEffort).toBe("low");
  });
});

describe("selector del front — mismo catálogo, misma retirada", () => {
  it("el selector no lista gpt-4.1-nano (el comentario de la cabecera puede nombrar la retirada)", () => {
    // Se busca la ENTRADA del catálogo (`id: "gpt-4.1-nano"`), no el literal suelto: la cabecera del
    // fichero cuenta por qué el modelo se retiró, y esa memoria sirve.
    expect(FRONT_MODELS).not.toMatch(/id:\s*"gpt-4\.1-nano"/);
    expect(FRONT_MODELS).not.toMatch(/label:\s*"[^"]*gpt-4\.1 nano/i);
  });

  it("luna arranca en `low` también en el front (si el front guarda un default, es el del back)", () => {
    const luna = FRONT_MODELS.match(/\{[^}]*id:\s*"gpt-5\.6-luna"[^}]*\}/)?.[0];
    expect(luna, "el front dejó de listar gpt-5.6-luna").toBeTruthy();
    expect(luna!).toMatch(/defaultEffort:\s*"low"/);
  });
});

describe("schema.prisma — los tres defaults pasan a gpt-5.6-luna", () => {
  it("Agent.model", () => {
    expect(bloqueDelSchema("Agent")).toMatch(
      /^\s*model\s+String\s+@default\("gpt-5\.6-luna"\)\s+@map\("modelo"\)/m
    );
  });

  it("SystemConfig.defaultAgentModel", () => {
    expect(bloqueDelSchema("SystemConfig")).toMatch(
      /^\s*defaultAgentModel\s+String\s+@default\("gpt-5\.6-luna"\)/m
    );
  });

  it("MarketStudy.model", () => {
    expect(bloqueDelSchema("MarketStudy")).toMatch(
      /^\s*model\s+String\s+@default\("gpt-5\.6-luna"\)\s+@map\("modelo"\)/m
    );
  });

  it("el schema no menciona ya gpt-4.1-nano en ningún sitio", () => {
    expect(SCHEMA).not.toMatch(/gpt-4\.1-nano/);
  });
});

describe("migración 20261110090000_retire_gpt_4_1_nano", () => {
  it("alinea los tres DEFAULT de columna con el schema (schema `aa`, columnas mapeadas)", () => {
    expect(migracion()).toContain(
      `ALTER TABLE "aa"."agente" ALTER COLUMN "modelo" SET DEFAULT 'gpt-5.6-luna';`
    );
    expect(migracion()).toContain(
      `ALTER TABLE "aa"."configuracion_sistema" ALTER COLUMN "modelo_agente_default" SET DEFAULT 'gpt-5.6-luna';`
    );
    expect(migracion()).toContain(
      `ALTER TABLE "aa"."estudio_mercado" ALTER COLUMN "modelo" SET DEFAULT 'gpt-5.6-luna';`
    );
  });

  it("reescribe los datos que quedaron apuntando al modelo retirado", () => {
    expect(migracion()).toContain(
      `UPDATE "aa"."agente" SET "modelo" = 'gpt-5.6-luna' WHERE "modelo" = 'gpt-4.1-nano';`
    );
    expect(migracion()).toContain(
      `UPDATE "aa"."configuracion_sistema" SET "modelo_agente_default" = 'gpt-5.6-luna' WHERE "modelo_agente_default" = 'gpt-4.1-nano';`
    );
    expect(migracion()).toContain(
      `UPDATE "aa"."estudio_mercado" SET "modelo" = 'gpt-5.6-luna' WHERE "modelo" = 'gpt-4.1-nano';`
    );
  });

  it("es no destructiva: no borra filas ni columnas, sólo reescribe un id", () => {
    const sql = migracion();
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });

  it("explica por qué existe (el 404 de deprecación), no sólo qué hace", () => {
    const sql = migracion();
    expect(sql).toMatch(/deprecat/i);
    expect(sql).toMatch(/gpt-4\.1-nano/);
  });
});
