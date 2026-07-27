/**
 * aa-catalogo-precios-fuente-unica (T3.1, T3.2) — Un precio, un sitio.
 *
 * `back/src/lib/service-catalog.ts` es código generado desde `front/lib/service-catalog.json`. Este
 * fichero es lo único que impide que vuelvan a derivar, y hay dos formas de romperlo: editar el
 * generado a mano, o cambiar el JSON y olvidar `npm run catalog:sync`. Las dos dan el mismo síntoma
 * —el fichero en disco no coincide con lo que produce el generador— así que un solo test las cubre.
 *
 * Por qué importa y no es cosmética: H6 va a cobrar con el número del back y `/tarifas` anuncia el del
 * front. Si discrepan, el cliente lee un precio en la web y le llega otro en el cargo, y el primero que
 * se entera es él.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  CATALOG_JSON_PATH,
  GENERATED_MODULE_PATH,
  readCatalogSource,
  renderCatalogModule,
  normalizeEol,
} from "../scripts/service-catalog-codegen";
import { SERVICE_CATALOG } from "@/lib/service-catalog";
import { DEFAULT_TOKEN_QUOTA_PER_AGENT } from "@/lib/quota";

describe("T3.2 — los ficheros que compara este test existen", () => {
  // Un test que no encuentra lo que compara y pasa igual es peor que no tenerlo: pareceria que hay
  // red y no la habría. Mismo criterio que el test de coherencia del cupo de H7.
  it("el JSON canónico sigue donde el generador lo busca", () => {
    expect(existsSync(CATALOG_JSON_PATH)).toBe(true);
  });

  it("el espejo generado sigue donde el back lo importa", () => {
    expect(existsSync(GENERATED_MODULE_PATH)).toBe(true);
  });
});

describe("T3.1 — AC3: el espejo del back no se edita a mano", () => {
  it("el fichero en disco es exactamente lo que produce el generador", () => {
    const enDisco = normalizeEol(readFileSync(GENERATED_MODULE_PATH, "utf8"));
    const renderizado = renderCatalogModule(readCatalogSource());

    // Si esto falla: o alguien editó el generado, o cambió el precio en el JSON sin regenerar.
    // Arreglo en los dos casos: `npm run catalog:sync`.
    expect(enDisco).toBe(renderizado);
  });

  it("AC6/E6: el render es determinista — misma entrada, mismo texto", () => {
    const source = readCatalogSource();

    // Sin esto el tripwire de arriba sería un falso rojo permanente: bastaría una fecha o un orden de
    // claves inestable en el generador para que nunca coincidiera con el fichero commiteado.
    expect(renderCatalogModule(source)).toBe(renderCatalogModule(source));
  });

  it("declara en la cabecera que es generado", () => {
    const enDisco = readFileSync(GENERATED_MODULE_PATH, "utf8");

    expect(enDisco).toContain("FICHERO GENERADO");
    expect(enDisco).toContain("catalog:sync");
  });
});

describe("AC4/AC6/E5 — el espejo lleva los importes y los tokens buenos", () => {
  it("los diez servicios, en el orden del JSON", () => {
    const source = readCatalogSource();

    expect(SERVICE_CATALOG.map((s) => s.id)).toEqual(source.services.map((s) => s.id));
  });

  it("cada importe del espejo es el del catálogo canónico", () => {
    const source = readCatalogSource();

    for (const esperado of source.services) {
      const real = SERVICE_CATALOG.find((s) => s.id === esperado.id);
      expect(real, `falta \`${esperado.id}\` en el espejo del back`).toBeDefined();
      expect(real!.implPrice, `implPrice de \`${esperado.id}\``).toBe(esperado.implPrice);
      expect(real!.maintPrice, `maintPrice de \`${esperado.id}\``).toBe(esperado.maintPrice);
      expect(real!.name).toBe(esperado.name);
      expect(real!.description).toBe(esperado.description);
    }
  });

  it("`tokens` es el cupo de plan en los servicios con agente y `null` en el resto", () => {
    const source = readCatalogSource();

    for (const esperado of source.services) {
      const real = SERVICE_CATALOG.find((s) => s.id === esperado.id)!;
      // El número vive una sola vez, en `planTokens`; el JSON solo dice sí o no por servicio.
      expect(real.tokens, `tokens de \`${esperado.id}\``).toBe(
        esperado.includesPlanTokens ? source.planTokens : null
      );
    }
  });

  it("`web_chatbot` sigue en 2950 / 180 con 10M de tokens", () => {
    // Importe congelado en validation.md: este cambio mueve datos de sitio, no tarifas.
    const web = SERVICE_CATALOG.find((s) => s.id === "web_chatbot")!;

    expect(web.implPrice).toBe(2950);
    expect(web.maintPrice).toBe(180);
    expect(web.tokens).toBe(10_000_000);
  });
});

describe("AC5/E4 — el cupo anunciado es el que aplica el back", () => {
  it("`planTokens` del catálogo es `DEFAULT_TOKEN_QUOTA_PER_AGENT`", () => {
    expect(readCatalogSource().planTokens).toBe(DEFAULT_TOKEN_QUOTA_PER_AGENT);
  });
});

describe("AC2/E2 — los importes salieron del TypeScript del front", () => {
  const typesFront = readFileSync(
    new URL("../../front/components/presupuestos/types.ts", import.meta.url),
    "utf8"
  );

  it("el fichero del front sigue donde se espera y deriva del JSON", () => {
    expect(typesFront).toContain("service-catalog.json");
  });

  it("no queda ningún importe literal en el TS del front", () => {
    // `implPrice: 540` en el TS significa que hay un segundo sitio donde cambiar un precio, que es
    // justo lo que este change elimina. La forma derivada es `implPrice: s.implPrice`.
    for (const campo of ["implPrice", "maintPrice"] as const) {
      const literal = new RegExp(`${campo}\\s*:\\s*\\d`);
      expect(literal.test(typesFront), `hay un \`${campo}\` con número en types.ts`).toBe(false);
    }
  });
});
