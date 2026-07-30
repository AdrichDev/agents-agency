/**
 * E9 (aa-agentes-economia-tokens, T5.1 / T5.2) — La compresión no borra reglas.
 *
 * La guía de estilo y la prosa de las herramientas se envían en CADA iteración del bucle, de CADA
 * mensaje, de CADA agente. Comprimirlas es la palanca E. El riesgo de esa palanca es obvio: recortar
 * texto es trivial, y la forma más fácil de bajar el contador es borrar una regla. Esto lo impide.
 *
 * Cada caso fija UNA regla de la versión larga por su parte sustantiva, no por su redacción: si
 * alguien vuelve a comprimir y se lleva la regla por delante, el test cae. Si sólo reescribe la
 * frase conservando el fondo, el test aguanta. Es a propósito.
 *
 * El techo de caracteres cierra el otro lado: sin él, la guía puede volver a engordar poco a poco
 * hasta deshacer T5.1 sin que nadie se dé cuenta.
 */
import { describe, it, expect } from "vitest";
import { CONVERSATION_STYLE_GUIDE } from "@/lib/agent/style";

const G = CONVERSATION_STYLE_GUIDE;

describe("E9 — guía de estilo comprimida (T5.1)", () => {
  // Tabla de equivalencia regla-a-regla, ejecutable. La versión larga tenía 15 reglas
  // repartidas en cuatro secciones (CÓMO SONAR / EMOJIS / RITMO / FORMATO); aquí están las 15,
  // cada una con la marca por la que se reconoce en el texto comprimido.
  const REGLAS: Array<[string, RegExp]> = [
    ["1. Persona real del equipo, no robot ni manual corporativo", /persona del equipo/i],
    ["2. Mensajes cortos de 1-3 frases", /1-3 frases/],
    ["3. Una sola pregunta por mensaje", /UNA sola pregunta/],
    ["4. Adaptar el tono al del usuario", /adapta el tono/i],
    ["5. Español de España con muletillas naturales", /"vale".*"perfecto"/],
    ["6. Fórmulas artificiales prohibidas (las cinco, literales)", /PROHIBIDO/],
    ["7. Máximo un emoji por mensaje y no en todos", /máximo UNO por mensaje/],
    ["8. Lista de emojis permitidos", /😊/],
    ["9. Nunca emojis en temas delicados", /NUNCA en quejas/],
    ["10. No resaludar ni representarse a mitad de conversación", /No vuelvas a saludar/i],
    ["11. No repetir el nombre del usuario en cada mensaje", /No repitas el nombre/i],
    ['12. No cerrar con "¿Hay algo más...?"', /¿Hay algo más/],
    ["13. Confirmar acciones breve y humano", /Confirma breve y humano/i],
    ["14. Si no sabes algo, decirlo y ofrecer el siguiente paso", /Si no sabes algo/i],
    ["15. Sin Markdown pesado; como mucho negrita puntual", /negrita/],
  ];

  it.each(REGLAS)("conserva la regla %s", (_regla, marca) => {
    expect(G).toMatch(marca);
  });

  it("manda escribir los enlaces en el formato que los canales saben pintar", () => {
    // Añadida después de una conversación real en la que el agente ofreció el enlace de la
    // política de privacidad tres veces y no dio ninguno. La regla tiene dos mitades: el
    // formato (lo único que los tres canales convierten en clicable) y la prohibición de
    // prometerlo sin darlo, que es lo que hizo.
    expect(G).toMatch(/\[texto\]\(url\)/);
    expect(G).toMatch(/Nunca prometas un enlace sin darlo/i);
  });

  it("conserva las CINCO fórmulas prohibidas, literales", () => {
    // No basta con decir "no uses fórmulas artificiales": un modelo al que no se le enseñan
    // cuáles las produce igual. Los literales SON la regla, así que aquí van uno a uno.
    for (const f of [
      "¡Absolutamente!",
      "No dudes en contactarnos",
      "Estaré encantado de asistirle",
      "Como asistente virtual",
      "¡Excelente pregunta!",
    ]) {
      expect(G).toContain(f);
    }
  });

  it("conserva los SIETE emojis permitidos", () => {
    for (const e of ["😊", "👍", "✅", "📅", "📍", "⏰", "✨"]) {
      expect(G).toContain(e);
    }
  });

  it("sigue marcando que prevalece sobre el formato por defecto", () => {
    // Sin esta línea la guía es una sugerencia, no una regla: el modelo la pisa con su
    // formato de fábrica (listas y títulos) en cuanto la pregunta es un poco compleja.
    expect(G).toContain("OBLIGATORIO");
  });

  it("no rebasa el techo de 1300 chars (partía de 1893)", () => {
    // T5.1 la dejó en 1202. El margen es para reescrituras, no para reglas nuevas: cualquier
    // añadido que no quepa aquí se paga en cada mensaje de cada agente y toca decidirlo aparte.
    expect(G.length).toBeLessThanOrEqual(1300);
  });
});
