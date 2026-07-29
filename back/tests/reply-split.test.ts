/**
 * T1.3 (aa-canales-buffer-y-respuesta-partida) — `splitReply`.
 * Función pura, sin mocks. Cubre GWT3 (sobrante al último trozo, sin pérdida de
 * texto) y GWT8 (el troceo no rompe URLs ni marcas de formato).
 */
import { describe, it, expect } from "vitest";
import {
  splitReply,
  clampReplyMaxMessages,
  REPLY_MAX_MESSAGES_CAP,
} from "@/lib/channels/reply-split";

describe("clampReplyMaxMessages", () => {
  it("trata como 'sin partir' cualquier valor no positivo o ausente", () => {
    expect(clampReplyMaxMessages(0)).toBe(1);
    expect(clampReplyMaxMessages(1)).toBe(1);
    expect(clampReplyMaxMessages(-3)).toBe(1);
    expect(clampReplyMaxMessages(null)).toBe(1);
    expect(clampReplyMaxMessages(undefined)).toBe(1);
    expect(clampReplyMaxMessages(Number.NaN)).toBe(1);
  });

  it("recorta al tope duro (AD5)", () => {
    expect(clampReplyMaxMessages(40)).toBe(REPLY_MAX_MESSAGES_CAP);
    expect(clampReplyMaxMessages(3)).toBe(3);
  });
});

describe("splitReply", () => {
  it("devuelve el texto entero con max = 1 (default, AC2)", () => {
    const text = "Primer párrafo.\n\nSegundo párrafo.";
    expect(splitReply(text, 1)).toEqual([text]);
  });

  it("devuelve lista vacía si no hay texto", () => {
    expect(splitReply("   \n  ", 3)).toEqual([]);
  });

  // GWT3
  it("parte por párrafo y concatena el sobrante en el último trozo", () => {
    const text = ["Uno.", "Dos.", "Tres.", "Cuatro."].join("\n\n");
    const chunks = splitReply(text, 3);

    expect(chunks).toEqual(["Uno.", "Dos.", "Tres.\n\nCuatro."]);
    expect(chunks).toHaveLength(3);
  });

  // GWT3 — invariante: no se pierde ni un carácter de contenido
  it("conserva todo el contenido original", () => {
    const text = ["Hola.", "¿Qué tal?", "Adiós.", "Hasta luego.", "Un saludo."].join("\n\n");
    const chunks = splitReply(text, 2);

    const rejoined = chunks.join("\n\n");
    expect(rejoined).toBe(text);
  });

  it("cae a frontera de frase cuando el texto viene de una sola tirada", () => {
    const text = "Abrimos de 9 a 14. Los sábados cerramos. ¿Te reservo hora?";
    const chunks = splitReply(text, 3);

    expect(chunks).toEqual(["Abrimos de 9 a 14.", "Los sábados cerramos.", "¿Te reservo hora?"]);
  });

  it("manda el texto entero si no hay ninguna frontera aprovechable", () => {
    const text = "una sola frase larga sin puntuación de cierre ni saltos de línea";
    expect(splitReply(text, 4)).toEqual([text]);
  });

  it("respeta el tope duro aunque se pidan más trozos", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Párrafo ${i + 1}.`).join("\n\n");
    expect(splitReply(text, 12)).toHaveLength(REPLY_MAX_MESSAGES_CAP);
  });

  // GWT8 — el `\s+` obligatorio de la frontera de frase protege las URLs
  it("no parte una URL por sus puntos", () => {
    const text = "Reserva en https://ejemplo.com/citas/hoy.html cuando quieras. Te esperamos.";
    const chunks = splitReply(text, 3);

    expect(chunks[0]).toContain("https://ejemplo.com/citas/hoy.html");
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/https?:\/\/\S*$/);
    }
  });

  // GWT8 — marcas de formato emparejadas dentro de cada trozo
  it("no deja marcas de negrita desemparejadas", () => {
    const text = "*Horario* de lunes a viernes.\n\n*Teléfono* 600 000 000.\n\nHasta pronto.";
    const chunks = splitReply(text, 3);

    for (const chunk of chunks) {
      const asterisks = (chunk.match(/\*/g) ?? []).length;
      expect(asterisks % 2).toBe(0);
    }
  });
});
