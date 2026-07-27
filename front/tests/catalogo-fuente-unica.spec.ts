/**
 * aa-catalogo-precios-fuente-unica (T1.4) — Los importes de hoy, congelados.
 *
 * Este change mueve los precios de un `.ts` a `front/lib/service-catalog.json`. El riesgo entero está
 * en que un importe cambie al copiarlo, así que la tabla de abajo es la de `validation.md` escrita a
 * mano una vez: es lo único que distingue "movimos los datos" de "movimos los datos y de paso subimos
 * una tarifa sin querer".
 *
 * Estructural, sin `page.goto`: lo que se comprueba es el catálogo que consume `/tarifas`, no el
 * píxel. La página ya se probó a mano y no cambia — sigue leyendo `SERVICES_CATALOG`.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SERVICES_CATALOG,
  PLAN_TOKENS,
  IVA_RATE,
} from "../components/presupuestos/types";

/** Importes vigentes, en euros y sin IVA. `planTokens` = lleva el cupo mensual de tokens. */
const TARIFAS_CONGELADAS = [
  { id: "chatbot_basic", implPrice: 540, maintPrice: 39, planTokens: true },
  { id: "chatbot_plus", implPrice: 1290, maintPrice: 99, planTokens: true },
  { id: "chatbot_pro", implPrice: 1730, maintPrice: 149, planTokens: true },
  { id: "web_basic", implPrice: 890, maintPrice: 59, planTokens: false },
  { id: "web_chatbot", implPrice: 2950, maintPrice: 180, planTokens: true },
  { id: "automation", implPrice: 750, maintPrice: 49, planTokens: false },
  { id: "crm", implPrice: 2000, maintPrice: 99, planTokens: false },
  { id: "hours", implPrice: 75, maintPrice: 0, planTokens: false },
  { id: "tokens_5m", implPrice: 0, maintPrice: 17, planTokens: false },
  { id: "tokens_10m", implPrice: 0, maintPrice: 30, planTokens: false },
] as const;

const TYPES_SRC = readFileSync(
  resolve(__dirname, "../components/presupuestos/types.ts"),
  "utf8"
);

test.describe("T1.1/AC6 — los importes no se movieron", () => {
  test("el catálogo tiene los diez servicios, en el orden de la tabla", () => {
    // El orden no es cosmético: es el que pinta la tabla de tarifas oficiales y el que decide qué cae
    // en cada página del paginador.
    expect(SERVICES_CATALOG.map((s) => s.id)).toEqual(
      TARIFAS_CONGELADAS.map((t) => t.id)
    );
  });

  for (const esperado of TARIFAS_CONGELADAS) {
    test(`${esperado.id} cobra ${esperado.implPrice} € + ${esperado.maintPrice} €/mes`, () => {
      const real = SERVICES_CATALOG.find((s) => s.id === esperado.id);

      expect(real, `\`${esperado.id}\` desapareció del catálogo`).toBeDefined();
      expect(real!.implPrice).toBe(esperado.implPrice);
      expect(real!.maintPrice).toBe(esperado.maintPrice);
      expect(real!.tokens).toBe(esperado.planTokens ? PLAN_TOKENS : undefined);
    });
  }

  test("el cupo de plan sigue siendo 10M y el IVA el 21%", () => {
    expect(PLAN_TOKENS).toBe(10_000_000);
    expect(IVA_RATE).toBe(0.21);
  });
});

test.describe("T1.2/AC2 — el precio ya no vive en el TypeScript", () => {
  test("`types.ts` importa el catálogo canónico", () => {
    expect(TYPES_SRC).toContain('from "@/lib/service-catalog.json"');
  });

  test("no queda ningún importe literal en `types.ts`", () => {
    // Si vuelve a aparecer `maintPrice: 99` aquí, hay dos sitios donde cambiar el mismo precio y el
    // change entero deja de servir para nada.
    for (const campo of ["implPrice", "maintPrice"] as const) {
      const literal = new RegExp(`${campo}\\s*:\\s*\\d`);
      expect(
        literal.test(TYPES_SRC),
        `\`${campo}\` con número literal en types.ts`
      ).toBe(false);
    }
  });

  test("los 10M tampoco están escritos dos veces", () => {
    // `PLAN_TOKENS` se deriva del JSON, y cada plan dice sí/no con un booleano en vez de repetir el
    // número. Es la misma regla en pequeño.
    expect(TYPES_SRC).toMatch(/export const PLAN_TOKENS\s*=\s*catalog\.planTokens/);
    expect(TYPES_SRC).not.toMatch(/10_000_000|10000000/);
  });
});

test.describe("AC7 — ningún consumidor cambia de API", () => {
  test("las entradas conservan la forma que espera el formulario de presupuestos", () => {
    for (const s of SERVICES_CATALOG) {
      expect(s.selected).toBe(false);
      expect(typeof s.name).toBe("string");
      expect(s.name.length).toBeGreaterThan(0);
      expect(typeof s.description).toBe("string");
    }
  });

  test("`hours` sigue arrancando en 10 unidades y el resto en 1", () => {
    // Cantidad inicial de la pantalla, no dato de catálogo: se vende por horas y pedir una sola hora
    // no es el caso normal. Vive en el TS a propósito.
    for (const s of SERVICES_CATALOG) {
      expect(s.quantity, `cantidad inicial de \`${s.id}\``).toBe(
        s.id === "hours" ? 10 : 1
      );
    }
  });
});
