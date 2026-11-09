// aa-agente-sin-inventar T2 (S2/AC2): every "(fuente: X)" in the reply must be lexically backed
// by a fragment whose public source is X; otherwise the citation goes and the sentence stays.
import { describe, it, expect } from "vitest";
import { enforceCitations, CITATION_MIN_OVERLAP } from "@/lib/agent/citations";

const MENU = "https://lafayette.es/carta";
const RESERVAS = "https://lafayette.es/reservas";

const fragments = [
  { source: MENU, content: "La cocina abre de 13:00 a 16:00 y de 20:00 a 23:30. Menú del día 18 euros." },
  { source: RESERVAS, content: "Las reservas se aceptan hasta las 15:30 para el turno de comida." },
];

describe("enforceCitations — citas respaldadas (S2)", () => {
  it("mantiene la cita cuando la frase está respaldada por el fragmento de esa fuente", () => {
    const reply = `La cocina abre de 13:00 a 16:00 y el menú del día cuesta 18 euros (fuente: ${MENU}).`;
    expect(enforceCitations(reply, fragments)).toBe(reply);
  });

  it("retira la cita de una afirmación que su fuente no dice, y deja la frase", () => {
    // H4: the model turned the booking window into a kitchen closing time and cited a real page.
    const reply = `La cocina cierra a las 15:45 los domingos (fuente: ${RESERVAS}).`;
    expect(enforceCitations(reply, fragments)).toBe("La cocina cierra a las 15:45 los domingos.");
  });

  it("retira la cita a una fuente que no se le entregó", () => {
    const reply = "La cocina abre de 13:00 a 16:00 (fuente: https://otra-web.es).";
    expect(enforceCitations(reply, fragments)).toBe("La cocina abre de 13:00 a 16:00.");
  });

  it("decide cada cita por separado en una respuesta con varias", () => {
    const reply =
      `Las reservas se aceptan hasta las 15:30 (fuente: ${RESERVAS}). ` +
      `Hay terraza climatizada para grupos grandes (fuente: ${MENU}).`;
    expect(enforceCitations(reply, fragments)).toBe(
      `Las reservas se aceptan hasta las 15:30 (fuente: ${RESERVAS}). ` +
        "Hay terraza climatizada para grupos grandes.",
    );
  });

  it("valida también la cita que va detrás del punto final", () => {
    const reply = `Hay terraza climatizada para grupos grandes. (fuente: ${MENU})`;
    expect(enforceCitations(reply, fragments)).toBe("Hay terraza climatizada para grupos grandes.");
  });

  it("no toca una respuesta sin citas", () => {
    const reply = "No tengo ese dato; te lo confirma el equipo.";
    expect(enforceCitations(reply, fragments)).toBe(reply);
  });

  it("sin fragmentos, ninguna cita sobrevive", () => {
    const reply = `La cocina abre de 13:00 a 16:00 (fuente: ${MENU}).`;
    expect(enforceCitations(reply, [])).toBe("La cocina abre de 13:00 a 16:00.");
  });

  // Mutation: with the threshold disabled the unsupported citation survives. This proves the
  // default threshold is what removes it, not the source match.
  it("el umbral muerde: con umbral 0 la cita sin respaldo sobreviviría", () => {
    const reply = `La cocina cierra a las 15:45 los domingos (fuente: ${RESERVAS}).`;
    expect(CITATION_MIN_OVERLAP).toBeGreaterThan(0);
    expect(enforceCitations(reply, fragments, 0)).toBe(reply);
    expect(enforceCitations(reply, fragments)).not.toBe(reply);
  });
});
