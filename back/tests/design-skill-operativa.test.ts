/**
 * Punto 4 del dueño: las skills de diseño tienen que estar operativas, no solo existir.
 * Esta prueba fija tres cosas que se rompen en silencio:
 *   1. que la skill de diseño exista con instrucciones reales y dentro del tope de `usar_skill`,
 *   2. que su descripción diga CUÁNDO usarla (es lo único que el modelo ve antes de decidir),
 *   3. que sus reglas lleguen de verdad al prompt de generación de landings.
 * Y una cuarta, de higiene del catálogo: toda skill propia debe ser usable de la misma forma.
 */
import { describe, it, expect } from "vitest";
import {
  BUILTIN_SKILLS,
  BUILTIN_INSTRUCTIONS_MAX,
  DESIGN_SKILL_NAME,
  builtinSkillByName,
} from "@/lib/skills/builtin-catalog";
import { designRulesBlock } from "@/lib/landing/prompt-master";

describe("catálogo propio — toda skill es usable por el agente", () => {
  it("cada skill tiene instrucciones, etiqueta y una descripción que dice cuándo usarla", () => {
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.instructions.trim().length, `${skill.name} sin instrucciones`).toBeGreaterThan(200);
      expect(skill.instructions.length, `${skill.name} supera el tope de usar_skill`).toBeLessThanOrEqual(
        BUILTIN_INSTRUCTIONS_MAX,
      );
      expect(skill.use.length, `${skill.name} sin etiqueta`).toBeGreaterThan(0);
      // La descripción es el disparador: tiene que nombrar cuándo usarla, no describir el tema.
      expect(skill.description.toLowerCase(), `${skill.name} no dice cuándo usarla`).toMatch(
        /úsala|usa esta|cuando|en cuanto|si el usuario|si alguien/,
      );
    }
  });

  it("no hay nombres repetidos (el seed hace upsert por nombre)", () => {
    const names = BUILTIN_SKILLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("skill de diseño", () => {
  it("existe, es `3a/…` y tiene las reglas que evitan una landing genérica", () => {
    const skill = builtinSkillByName(DESIGN_SKILL_NAME);
    expect(skill).toBeDefined();
    expect(DESIGN_SKILL_NAME.startsWith("3a/")).toBe(true);
    const text = skill!.instructions;
    for (const regla of [
      /tres direcciones/i,
      /paleta/i,
      /tipograf/i,
      /contraste/i,
      /checklist/i,
      /no parezca|delata a una ia/i,
    ]) {
      expect(text, `falta ${regla}`).toMatch(regla);
    }
  });

  it("sus reglas llegan al prompt de generación de landings", () => {
    const block = designRulesBlock();
    expect(block).toMatch(/Reglas de diseño OBLIGATORIAS/);
    expect(block).toMatch(/tres direcciones/i);
    expect(block.length).toBeLessThanOrEqual(BUILTIN_INSTRUCTIONS_MAX + 200);
  });
});
