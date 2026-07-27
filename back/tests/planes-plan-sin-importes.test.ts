/**
 * H4 (aa-planes-y-cuotas, T4.1) — `Plan` no expone NINGÚN campo monetario.
 *
 * Esto es un test de esquema, no de comportamiento, y existe por una razón concreta: la decisión de
 * que el importe vive en Stripe y no en AA no se puede defender con un comentario. Una columna de
 * precio se cuela en una migración posterior sin que nadie lo note, y a partir de ese día hay dos
 * fuentes de verdad para el número que se cobra de verdad — el panel enseña una cifra, la tarjeta se
 * carga otra, y ninguna es demostrablemente la correcta.
 *
 * Se leen el esquema Y la migración a propósito: el esquema es lo que Prisma aplica, pero SQL suelto
 * en una migración podría añadir la columna sin tocar el modelo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** Cualquier cosa que huela a dinero. Se busca sobre nombres de campo, no sobre prosa. */
const MONEY =
  /precio|price|importe|coste|\bcost\b|amount|moneda|currency|tarifa|euro|\beur\b|cent|iva|tax|fee/i;

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260727030000_plan_sin_importes/migration.sql", import.meta.url),
  "utf8"
);

/** Cuerpo del modelo, sin los `///` de cabecera (que sí hablan de precios, para explicar por qué no hay). */
function modelBody(name: string): string {
  const m = schema.match(new RegExp(`\\nmodel ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`modelo ${name} no encontrado en schema.prisma`);
  return m[1];
}

/** Nombres de campo declarados, ignorando comentarios de línea y atributos de bloque. */
function fieldNames(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => l && !l.startsWith("@@"))
    .map((l) => l.split(/\s+/)[0]);
}

describe("T4.1 — el esquema de `Plan` no expone ningún campo monetario", () => {
  const body = modelBody("Plan");

  it("existe el modelo con los campos que sí le tocan", () => {
    const names = fieldNames(body);
    expect(names).toContain("codigo");
    expect(names).toContain("nombre");
    expect(names).toContain("tokenQuotaPerAgent");
    expect(names).toContain("isActive");
  });

  it("ningún nombre de campo es monetario", () => {
    const monetary = fieldNames(body).filter((n) => MONEY.test(n));
    expect(monetary).toEqual([]);
  });

  it("ninguna columna mapeada (`@map`) es monetaria", () => {
    // El nombre en TypeScript podría ser inocente y la columna no. Se comprueban los dos lados.
    const mapped = [...body.matchAll(/@map\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(mapped.filter((c) => MONEY.test(c))).toEqual([]);
  });

  it("el cupo por agente admite `null` — sin tope es un caso válido, no un hueco", () => {
    expect(body).toMatch(/tokenQuotaPerAgent\s+Int\?/);
  });
});

describe("T4.1 — la migración tampoco crea columnas monetarias", () => {
  it("`CREATE TABLE \"plan\"` no declara ninguna columna de dinero", () => {
    const create = migration.match(/CREATE TABLE "plan" \(([\s\S]*?)\n\);/);
    expect(create).not.toBeNull();
    const columnas = [...create![1].matchAll(/"([a-z_]+)"\s+[A-Z]/g)].map((m) => m[1]);
    expect(columnas.length).toBeGreaterThan(0);
    expect(columnas.filter((c) => MONEY.test(c))).toEqual([]);
  });

  it("no relaja el cupo del tenant a NOT NULL ni le pone un default nuevo", () => {
    // El sentido de T4 es que el cupo pueda NO estar puesto (lo gobierna el plan). Volver a
    // ponerle un default numérico reintroduciría `DEFAULT_TOKEN_BALANCE` por la puerta de atrás.
    expect(migration).toMatch(/ALTER COLUMN "saldo_tokens" DROP NOT NULL/);
    expect(migration).toMatch(/ALTER COLUMN "saldo_tokens" DROP DEFAULT/);
    expect(migration).not.toMatch(/ALTER COLUMN "saldo_tokens" SET DEFAULT/);
  });
});
