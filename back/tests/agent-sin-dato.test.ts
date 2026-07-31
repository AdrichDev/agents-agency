/**
 * T1.1/T1.2 (aa-agente-no-inventa-datos-ni-politicas, AC1 y AC3) — lo que falta se DICE.
 *
 * T0 midió que las tres reglas anti-invención ya están en el prompt (`engine.ts:327-333`,
 * `base-directives.ts:69`) y que `gpt-5.4-mini` las cumple 3/3 mientras `gpt-4.1-nano` no. Así
 * que estos dos bloques no reescriben ninguna regla: convierten la ausencia en un HECHO del
 * turno, que es el patrón que ya funciona en `lead-contact.ts` y `booking-contact.ts`.
 */
import { describe, it, expect } from "vitest";
import { buildContextFactsBlock, buildKnowledgeBlock } from "@/lib/agent/engine";

describe("buildKnowledgeBlock — cero fragmentos (T1.1, AC1)", () => {
  const bloque = buildKnowledgeBlock([]);

  it("ya no calla: antes devolvía null y el turno se iba sin saber que la búsqueda se hizo", () => {
    // Ese silencio es lo que acaba en la fila H4: sin nada que diga "no consta", el modelo sirve
    // el dato adyacente que sí tiene a mano.
    expect(bloque).not.toBeNull();
  });

  it("dice que la búsqueda ya se hizo y que salió vacía", () => {
    expect(bloque).toContain("CERO fragmentos");
    expect(bloque).toMatch(/NO consta/i);
  });

  it("prohíbe el dato parecido y ofrece la salida: el contacto del negocio", () => {
    expect(bloque).toMatch(/dato PARECIDO/i);
    expect(bloque).toMatch(/contacto directo/i);
  });

  it("prohíbe citar fuente, porque no hay ninguna que citar", () => {
    expect(bloque).toMatch(/no cites ninguna fuente/i);
  });
});

describe("buildKnowledgeBlock — con fragmentos (sin regresión)", () => {
  it("numera los fragmentos y cita la URL cuando la hay", () => {
    const bloque = buildKnowledgeBlock([
      { source: "https://x.es/a", content: "Croquetas 11,00 €" },
      { source: null, content: "Menestra de verduras" },
    ]);
    expect(bloque).toContain("[1] fuente: https://x.es/a");
    expect(bloque).toContain("Croquetas 11,00 €");
    // Sin URL pública, ni se numera con fuente ni se nombra el documento: es la fuga que
    // `publicSource` cierra en origen.
    expect(bloque).toContain("[2]\nMenestra de verduras");
  });

  it("no arrastra el aviso de ausencia cuando sí hay conocimiento", () => {
    const bloque = buildKnowledgeBlock([{ source: null, content: "Menestra de verduras" }]);
    expect(bloque).not.toContain("CERO fragmentos");
  });
});

describe("buildContextFactsBlock — nombre no conocido (T1.2, AC3)", () => {
  it("con nombre conocido no cambia nada respecto de lo que ya había", () => {
    // Regresión sobre T4.1 de aa-agentes-economia-tokens: este bloque viaja fuera del prefijo
    // cacheable y su texto es el mismo de antes.
    const bloque = buildContextFactsBlock("nombre: Julia; teléfono: 622334455");
    expect(bloque).toBe(
      "Datos del contacto ya conocidos: nombre: Julia; teléfono: 622334455. Úsalos, no los vuelvas a pedir."
    );
  });

  it("sin nombre conocido lo dice y prohíbe inventarlo", () => {
    const bloque = buildContextFactsBlock("teléfono: 622334455", false);
    expect(bloque).toContain("teléfono: 622334455");
    expect(bloque).toMatch(/nombre del cliente NO consta/i);
    expect(bloque).toMatch(/ni te lo inventes/i);
  });

  it("sin ningún dato de contacto no gasta bloque, tampoco sin nombre", () => {
    // El turno corriente —el visitante aún no ha dado nada— es la mayoría de los turnos. Avisar
    // ahí cuesta tokens en cada uno y no compra nada: el modelo no está componiendo reserva
    // alguna todavía. C5 rompe en el caso de arriba, con contacto ya acumulado.
    expect(buildContextFactsBlock(null, false)).toBeNull();
    expect(buildContextFactsBlock("   ", false)).toBeNull();
    expect(buildContextFactsBlock(null, true)).toBeNull();
  });
});
