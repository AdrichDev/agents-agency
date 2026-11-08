/**
 * skill-effect — ¿se nota una skill en la conversación? (medición objetiva)
 *
 * El script `scripts/verify-builtin-skill.ts` corre el MISMO agente con y sin una skill
 * instalada. Sin un criterio objetivo, la única salida posible es "las respuestas parecen
 * distintas", que no es una verificación. Estos casos fijan ese criterio: cada comprobación
 * sale de una línea concreta de `src/lib/skills/builtin-catalog.ts`, y aquí se prueba que
 * pasa lo que debe pasar y falla lo que debe fallar — incluidas las casi-respuestas que se
 * parecen a lo correcto sin serlo, que son justo las que un ojo humano aprueba por error.
 */
import { describe, it, expect } from "vitest";
import type { ToolCallRecord } from "@/lib/agent/types";
import { BUILTIN_SKILLS } from "@/lib/skills/builtin-catalog";
import {
  SKILL_SCENARIOS,
  calledUsarSkill,
  scenarioForSkill,
  type SkillCheckResult,
} from "@/lib/skills/skill-effect";

const RESERVA = "3a/reserva-de-cita";
const DATOS = "3a/datos-personales-en-el-chat";
const QUEJAS = "3a/quejas-y-reclamaciones";

/** Ejecuta la comprobación de una skill concreta; falla el test si el escenario no existe. */
function comprobar(skill: string, reply: string): SkillCheckResult {
  const scenario = scenarioForSkill(skill);
  if (!scenario) throw new Error(`No hay escenario registrado para ${skill}`);
  return scenario.check(reply);
}

describe("escenarios de skill — forma", () => {
  it("cubre exactamente las tres skills que se van a medir", () => {
    expect(SKILL_SCENARIOS.map((s) => s.skill)).toEqual([RESERVA, DATOS, QUEJAS]);
  });

  it("cada escenario apunta a una skill real del catálogo, con al menos un mensaje", () => {
    // Un nombre inventado aquí mediría una skill que no existe: el script instalaría nada,
    // las dos ramas serían idénticas y el informe diría "NO SE NOTA" señalando al modelo.
    for (const s of SKILL_SCENARIOS) {
      expect(BUILTIN_SKILLS.some((b) => b.name === s.skill), s.skill).toBe(true);
      expect(s.messages.length, s.skill).toBeGreaterThan(0);
      for (const m of s.messages) expect(m.trim(), s.skill).not.toBe("");
    }
  });

  it("un fallo nunca es mudo: siempre trae motivo, y un aprobado no trae ninguno", () => {
    for (const s of SKILL_SCENARIOS) {
      const fallo = s.check("");
      expect(fallo.pass, s.skill).toBe(false);
      expect(fallo.reasons.length, s.skill).toBeGreaterThan(0);
      for (const motivo of fallo.reasons) expect(motivo.trim(), s.skill).not.toBe("");
    }
  });
});

describe("3a/reserva-de-cita — la recapitulación de cierre", () => {
  // Skill: "Confirmar → Cierra siempre repitiendo: «Entonces: [servicio], el [día] a las
  // [hora], a nombre de [nombre]. ¿Correcto?»".
  it("aprueba la respuesta que repite servicio, día y hora y pide conformidad", () => {
    const r = comprobar(
      RESERVA,
      "Entonces: corte de pelo, el jueves a las 17:00. ¿Correcto? Si quieres lo movemos.",
    );
    expect(r.reasons).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it("tolera mayúsculas, acentos y la hora escrita con letras", () => {
    // La skill manda la FORMA de la frase, no una cadena literal: un modelo que escribe
    // "¿CORRECTO?" o "a las cinco de la tarde" ha cumplido igual.
    expect(comprobar(RESERVA, "ENTONCES: Corte de pelo, el Jueves a las 17h. ¿CORRECTO?").pass).toBe(
      true,
    );
    expect(
      comprobar(RESERVA, "Entonces: corte de pelo, el jueves a las cinco de la tarde. ¿Correcto?")
        .pass,
    ).toBe(true);
  });

  it("NO aprueba la confirmación sin recapitulación (casi-acierto)", () => {
    // Es el fallo más probable: el modelo pregunta "¿Correcto?" sin haber repetido nada,
    // y en pantalla parece que ha cerrado la cita.
    const r = comprobar(RESERVA, "Perfecto, queda apuntado. ¿Correcto?");
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/recapitul/i);
  });

  it("NO aprueba la recapitulación sin pregunta de conformidad (casi-acierto)", () => {
    const r = comprobar(RESERVA, "Tomo nota: corte de pelo el jueves a las 17:00. Ya está hecho.");
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/conformidad/i);
  });

  it("NO aprueba una recapitulación a la que le falta la hora", () => {
    // "el jueves" sin hora no cierra nada: es exactamente el malentendido que la frase evita.
    const r = comprobar(RESERVA, "Entonces: corte de pelo, el jueves por la mañana. ¿Correcto?");
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/recapitul/i);
  });
});

describe("3a/datos-personales-en-el-chat — ni repetir ni tramitar la tarjeta", () => {
  // Skill: "Si te los mandan igualmente → 1. No los repitas en tu respuesta. Ni para
  // confirmar. 2. Di, sin dramatizar, que por seguridad esos datos no se tratan por chat.
  // 3. Redirige al canal que corresponda".
  const TARJETA = "4111 1111 1111 1111";

  it("el escenario enseña de verdad una tarjeta (el criterio y el caso van juntos)", () => {
    const scenario = scenarioForSkill(DATOS);
    expect(scenario?.messages.join(" ")).toContain(TARJETA);
  });

  it("aprueba la respuesta que rechaza el dato y redirige sin repetirlo", () => {
    const r = comprobar(
      DATOS,
      "Por seguridad no gestionamos datos de tarjeta por aquí. El pago se hace en el enlace " +
        "cifrado del equipo o por teléfono, y te lo confirman ellos.",
    );
    expect(r.reasons).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it("admite la tarjeta enmascarada: no es repetir el dato", () => {
    expect(comprobar(DATOS, "No trato tarjetas por chat. Veo un pago pendiente de la tarjeta terminada en 1111; lo cierra el equipo por teléfono.").pass).toBe(true);
  });

  it("NO aprueba el rechazo que repite los dígitos (casi-acierto)", () => {
    // El modelo "avisa" y de paso deja la tarjeta escrita en el historial. Es justo lo que
    // la skill prohíbe: la conversación se guarda.
    const r = comprobar(
      DATOS,
      `No gestionamos pagos por chat. He anotado la tarjeta ${TARJETA} para que el equipo la use.`,
    );
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/repite|dígitos|digitos/i);
  });

  it("NO aprueba la respuesta que tramita la tarjeta sin rechazarla (casi-acierto)", () => {
    const r = comprobar(DATOS, "Hecho, cobro ahora con la tarjeta que me has pasado. Gracias.");
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/no rechaza|rechaz/i);
  });
});

describe("3a/quejas-y-reclamaciones — empatía primero, cero emoji", () => {
  // Skill: "Los primeros segundos → Reconoce el problema antes de explicar nada. «Entiendo,
  // y siento la molestia»..." y "Tono → Frases cortas. Sin emoticonos. Sin entusiasmo."
  it("aprueba la respuesta que reconoce el problema en la primera frase y no usa emoji", () => {
    const r = comprobar(
      QUEJAS,
      "Entiendo, y siento la molestia. Cuénteme qué pasó y cuándo: recojo el caso y le digo qué pasa después.",
    );
    expect(r.reasons).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it("NO aprueba la respuesta empática que mete un emoji (casi-acierto)", () => {
    const r = comprobar(QUEJAS, "Entiendo tu frustración 😊 ¿Me pasas el número de pedido?");
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/emoji|emoticono/i);
    // La empatía sí estaba: el motivo tiene que ser sólo el emoji.
    expect(r.reasons).toHaveLength(1);
  });

  it("NO aprueba el emoticono de texto: también es un emoticono", () => {
    const r = comprobar(QUEJAS, "Entiendo, siento la molestia :) ¿Me dices tu pedido?");
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/emoji|emoticono/i);
  });

  it("NO aprueba explicar antes de reconocer el problema (casi-acierto)", () => {
    // La empatía está, pero en la segunda frase: la skill pide los primeros segundos.
    const r = comprobar(
      QUEJAS,
      "Su pedido está en reparto. Entiendo que la espera es molesta, lo miro con el equipo.",
    );
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/reconoce|empatic|empatía|primera frase/i);
  });
});

describe("calledUsarSkill — ¿pidió el modelo la skill por su cuenta?", () => {
  const llamada = (input: unknown, tool = "usar_skill"): ToolCallRecord => ({
    tool,
    input,
    output: {},
  });

  it("detecta la llamada a usar_skill con el nombre exacto de la skill", () => {
    expect(calledUsarSkill([llamada({ skillName: RESERVA })], RESERVA)).toBe(true);
  });

  it("tolera espacios y mayúsculas en el nombre", () => {
    expect(calledUsarSkill([llamada({ skillName: "  3A/Reserva-De-Cita " })], RESERVA)).toBe(true);
  });

  it("no confunde la llamada a otra skill ni la de otra herramienta", () => {
    expect(calledUsarSkill([llamada({ skillName: DATOS })], RESERVA)).toBe(false);
    expect(calledUsarSkill([llamada({ skillName: RESERVA }, "search_knowledge")], RESERVA)).toBe(
      false,
    );
  });

  it("lee el nombre también cuando el input llegó como JSON en crudo (rama de error)", () => {
    // `runToolLoop` guarda `tc.function.arguments` sin parsear cuando el parseo revienta.
    expect(calledUsarSkill([llamada(`{"skillName":"${RESERVA}"}`)], RESERVA)).toBe(true);
    expect(calledUsarSkill([llamada(`{"skillName":"${DATOS}"}`)], RESERVA)).toBe(false);
    expect(calledUsarSkill([llamada(`{"otra":"${RESERVA}"}`)], RESERVA)).toBe(false);
  });

  it("no revienta sin tool calls, con input raro ni sin nombre que buscar", () => {
    expect(calledUsarSkill(undefined, RESERVA)).toBe(false);
    expect(calledUsarSkill([], RESERVA)).toBe(false);
    expect(calledUsarSkill([llamada(null)], RESERVA)).toBe(false);
    expect(calledUsarSkill([llamada({})], RESERVA)).toBe(false);
    expect(calledUsarSkill([llamada(42)], RESERVA)).toBe(false);
    expect(calledUsarSkill([llamada({ skillName: RESERVA })], "")).toBe(false);
  });
});
