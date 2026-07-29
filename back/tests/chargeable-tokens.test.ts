/**
 * aa-cupo-cache-y-prefijo — T1.3.
 *
 * El cupo del cliente se mide en tokens, pero no todos los tokens cuestan igual: el proveedor
 * sirve el prefijo repetido de su caché entre 2x y 10x más barato. Cobrarlos a precio completo es
 * un error sistemático a favor de quien cobra — medido en 38% del cupo sobre una conversación real
 * de 13 turnos en gpt-5.4-mini (`evidence.md`).
 *
 * Lo que estos tests protegen no es la aritmética (es una resta), es la POLÍTICA de cuándo NO
 * ponderar. Cada rama que devuelve el bruto es una decisión de fallar hacia lo conocido, y sin
 * test cualquiera la "simplificaría" a un `?? 0` que aflojaría el cupo con datos inventados.
 */
import { describe, it, expect } from "vitest";
import { chargeableTokens } from "@/lib/token-metering";
import { CACHED_TOKEN_RATIO } from "@/lib/model-capabilities";

describe("AC1 — los tokens cacheados se imputan por su fracción de precio", () => {
  it("gpt-5.4-mini descuenta el 90% de lo cacheado", () => {
    // 3000 totales, 1000 servidos de caché a 0,1x ⇒ 3000 − 1000*0,9 = 2100.
    expect(chargeableTokens(3000, 1000, "gpt-5.4-mini")).toBe(2100);
  });

  it("gpt-4.1-mini descuenta el 75%: el ratio es POR MODELO, no una constante", () => {
    // Este es el test que hace falso un peso fijo. Mismo turno, mismo cacheado, distinto modelo:
    // 3000 − 1000*0,75 = 2250. Un peso único sería incorrecto para cuatro de los cinco modelos
    // que hay en producción.
    expect(chargeableTokens(3000, 1000, "gpt-4.1-mini")).toBe(2250);
  });

  it("gpt-4o descuenta el 50%", () => {
    expect(chargeableTokens(3000, 1000, "gpt-4o")).toBe(2500);
  });

  it("todo el prompt cacheado sigue imputando la salida, que nunca se cachea", () => {
    // 1200 de prompt íntegramente cacheado + 300 de salida = 1500 totales.
    // 1500 − 1200*0,9 = 420. Si esto diera ~0, la salida se estaría regalando.
    expect(chargeableTokens(1500, 1200, "gpt-5.4-mini")).toBe(420);
  });

  it("redondea contra el cliente, no contra el propietario", () => {
    // 1001 − 333*0,9 = 701,3 ⇒ 702. Un token no importa; la dirección del redondeo, aplicada
    // millones de veces, es una decisión de política y va deliberadamente en contra de quien cobra.
    expect(chargeableTokens(1001, 333, "gpt-5.4-mini")).toBe(702);
  });
});

describe("AC2 — un modelo sin ratio verificado NO se pondera", () => {
  it("gemini-3.5-flash imputa el bruto", () => {
    // Su ratio real no se ha comprobado contra doc oficial. Inventarlo aflojaría el cupo con un
    // número indefendible; devolver el bruto es exactamente el comportamiento previo al cambio.
    expect(chargeableTokens(3000, 1000, "gemini-3.5-flash")).toBe(3000);
  });

  it("un id de modelo que aún no existe imputa el bruto", () => {
    expect(chargeableTokens(3000, 1000, "gpt-6-turbo-hipotetico")).toBe(3000);
  });

  it("modelo vacío (llamadores que no lo informan) imputa el bruto", () => {
    expect(chargeableTokens(3000, 1000, "")).toBe(3000);
  });

  it("la tabla no tiene ratios fuera de (0,1): un 0 regalaría el cupo y un 1 no descontaría nada", () => {
    for (const [model, ratio] of Object.entries(CACHED_TOKEN_RATIO)) {
      expect(ratio, model).toBeGreaterThan(0);
      expect(ratio, model).toBeLessThan(1);
    }
  });
});

describe("AC3 — un dato ausente o incoherente no vale como descuento", () => {
  it("cachedTokens null imputa el bruto", () => {
    // `null` es "el proveedor no informó `prompt_tokens_details`", no "la caché falló". Tratarlo
    // como 0 daría el mismo resultado aquí, pero por la razón equivocada.
    expect(chargeableTokens(3000, null, "gpt-5.4-mini")).toBe(3000);
  });

  it("cachedTokens undefined imputa el bruto", () => {
    expect(chargeableTokens(3000, undefined, "gpt-5.4-mini")).toBe(3000);
  });

  it("cero cacheados imputa el bruto", () => {
    expect(chargeableTokens(3000, 0, "gpt-5.4-mini")).toBe(3000);
  });

  it("más cacheados que totales: dato imposible, se ignora en vez de emitir un cargo menor", () => {
    // Los cacheados son un subconjunto del prompt, que es subconjunto del total. Si un proveedor
    // informara lo contrario, el número no es de fiar y no puede decidir cuánto se cobra.
    expect(chargeableTokens(1000, 5000, "gpt-5.4-mini")).toBe(1000);
  });

  it("cacheados negativos se ignoran", () => {
    expect(chargeableTokens(1000, -50, "gpt-5.4-mini")).toBe(1000);
  });

  it("nunca devuelve más que el bruto ni menos que la salida", () => {
    // Invariante que resume las dos direcciones del riesgo: ponderar no puede inflar el cargo,
    // ni puede dejarlo por debajo de lo que cuesta la parte no cacheable.
    for (const cached of [0, 1, 500, 999, 1000]) {
      const v = chargeableTokens(1000, cached, "gpt-5.4-mini");
      expect(v).toBeLessThanOrEqual(1000);
      expect(v).toBeGreaterThan(0);
    }
  });
});
