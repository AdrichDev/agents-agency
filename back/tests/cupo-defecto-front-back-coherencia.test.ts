/**
 * H7 (aa-cupo-defecto-y-avisos, T4.2) — El número que se aplica es el número que se anuncia.
 *
 * `PLAN_TOKENS = 10_000_000` ya existía en el catálogo del front y es el que alimenta `/tarifas`. Si el
 * back aplicara 10M y el front anunciara otra cosa, el cliente leería una promesa que la máquina no
 * cumple, y el que se enteraría primero sería él.
 *
 * Front y back son paquetes separados y no se pueden importar entre sí, pero el fichero se puede leer:
 * mismo recurso que usó H4 T4.1 para probar que `Plan` no tiene importes. Esto NO unifica los catálogos
 * duplicados —eso es otro change— pero cierra la puerta a que este número derive.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_TOKEN_QUOTA_PER_AGENT } from "@/lib/quota";

const catalogoFront = readFileSync(
  new URL("../../front/components/presupuestos/types.ts", import.meta.url),
  "utf8"
);

describe("T4.2 — AC11: la constante del back coincide con la del front", () => {
  it("el fichero del catálogo del front sigue donde se espera y declara `PLAN_TOKENS`", () => {
    // Si alguien mueve o renombra esto, el test cae aquí y no en un silencio: un test que no encuentra
    // lo que compara y pasa igual es peor que no tenerlo.
    expect(catalogoFront).toMatch(/export const PLAN_TOKENS\s*=/);
  });

  it("`PLAN_TOKENS` del front es exactamente `DEFAULT_TOKEN_QUOTA_PER_AGENT` del back", () => {
    const m = catalogoFront.match(/export const PLAN_TOKENS\s*=\s*([0-9_]+)/);
    expect(m).not.toBeNull();
    const planTokens = Number(m![1].replaceAll("_", ""));

    expect(planTokens).toBe(DEFAULT_TOKEN_QUOTA_PER_AGENT);
  });

  it("el número sigue siendo 10M en los dos lados", () => {
    expect(DEFAULT_TOKEN_QUOTA_PER_AGENT).toBe(10_000_000);
  });
});
