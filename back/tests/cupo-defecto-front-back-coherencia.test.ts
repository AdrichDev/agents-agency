/**
 * H7 (aa-cupo-defecto-y-avisos, T4.2) — El número que se aplica es el número que se anuncia.
 *
 * `planTokens = 10_000_000` es el cupo que alimenta `/tarifas`. Si el back aplicara 10M y el front
 * anunciara otra cosa, el cliente leería una promesa que la máquina no cumple, y el que se enteraría
 * primero sería él.
 *
 * Front y back son paquetes separados y no se pueden importar entre sí, pero el fichero se puede leer:
 * mismo recurso que usó H4 T4.1 para probar que `Plan` no tiene importes.
 *
 * Actualizado en aa-catalogo-precios-fuente-unica (T3.3): el número dejó de estar escrito en el TS del
 * front —`PLAN_TOKENS` ahora se deriva— y pasó al catálogo canónico `front/lib/service-catalog.json`.
 * Leer el literal con una expresión regular sobre el TS ya no encontraría nada. La duplicación de
 * catálogos que este test documentaba como "otro change" es justo la que se cerró ahí.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_TOKEN_QUOTA_PER_AGENT } from "@/lib/quota";

const CATALOGO_URL = new URL("../../front/lib/service-catalog.json", import.meta.url);

describe("T4.2 — AC11: la constante del back coincide con la del catálogo", () => {
  it("el catálogo canónico sigue donde se espera y declara `planTokens`", () => {
    // Si alguien mueve o renombra esto, el test cae aquí y no en un silencio: un test que no encuentra
    // lo que compara y pasa igual es peor que no tenerlo.
    const catalogo = JSON.parse(readFileSync(CATALOGO_URL, "utf8"));

    expect(typeof catalogo.planTokens).toBe("number");
  });

  it("`planTokens` del catálogo es exactamente `DEFAULT_TOKEN_QUOTA_PER_AGENT` del back", () => {
    const catalogo = JSON.parse(readFileSync(CATALOGO_URL, "utf8"));

    expect(catalogo.planTokens).toBe(DEFAULT_TOKEN_QUOTA_PER_AGENT);
  });

  it("el front sigue derivando `PLAN_TOKENS` del catálogo, sin copiar el número", () => {
    const typesFront = readFileSync(
      new URL("../../front/components/presupuestos/types.ts", import.meta.url),
      "utf8"
    );

    // La forma que se exige: `export const PLAN_TOKENS = catalog.planTokens`. Un literal aquí sería
    // volver a tener dos sitios donde cambiar el mismo número.
    expect(typesFront).toMatch(/export const PLAN_TOKENS\s*=\s*catalog\.planTokens/);
  });

  it("el número sigue siendo 10M en los dos lados", () => {
    expect(DEFAULT_TOKEN_QUOTA_PER_AGENT).toBe(10_000_000);
  });
});
