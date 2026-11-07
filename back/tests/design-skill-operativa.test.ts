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
  DESIGN_SKILL_NAMES,
  designSkills,
  builtinSkillByName,
} from "@/lib/skills/builtin-catalog";
import { designRulesBlock, landingFileContract } from "@/lib/landing/prompt-master";

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

describe("skills de diseño (tres piezas que se combinan)", () => {
  it("son tres, existen y cubren estructura, tipografía/color y copy/CTA", () => {
    expect(DESIGN_SKILL_NAMES).toHaveLength(3);
    expect(designSkills()).toHaveLength(3);
    for (const name of DESIGN_SKILL_NAMES) {
      const skill = builtinSkillByName(name);
      expect(skill, `${name} no está en el catálogo`).toBeDefined();
      expect(name.startsWith("3a/")).toBe(true);
    }
    const all = designSkills().map((s) => s.instructions).join("\n");
    for (const regla of [/tres direcciones/i, /paleta/i, /contraste/i, /tipograf/i, /dos líneas/i, /botones/i]) {
      expect(all, `falta ${regla}`).toMatch(regla);
    }
  });

  it("el generador las recibe TODAS, en orden, sin pedirle al modelo que elija", () => {
    const block = designRulesBlock();
    expect(block).toMatch(/se combinan, no se eligen/);
    for (const name of DESIGN_SKILL_NAMES) expect(block).toContain(`--- ${name} ---`);
    // El orden del bloque es el orden declarado.
    const positions = DESIGN_SKILL_NAMES.map((n) => block.indexOf(n));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("el contrato de ficheros fija raíz propia, webp y mocks permitidos", () => {
    const c = landingFileContract();
    expect(c).toMatch(/carpeta raíz/i);
    expect(c).toMatch(/webp/i);
    expect(c).toMatch(/mock SÍ se permiten imágenes externas/i);
    expect(c).toMatch(/no se crean/i);
  });

  it("el contrato admite el CDN de Tailwind solo en el borrador y lo deja al build de AA", () => {
    const c = landingFileContract();
    expect(c).toMatch(/borrador.*CDN de Tailwind/i);
    expect(c).toMatch(/build de AA lo compila/i);
    expect(c).toMatch(/entrega no lleva CDNs de terceros ni fuentes remotas/i);
  });
});
