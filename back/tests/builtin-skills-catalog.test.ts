/**
 * T1.4 (aa-skills-propias-tenant) — El catálogo de skills propias.
 *
 * Estas skills son producto: son literalmente lo que el agente de un cliente contesta cuando
 * le preguntan por un precio o por un síntoma. Lo que defienden estos casos no es "el objeto
 * tiene los campos": es que no se pueda colar en producción una skill que se trunca a media
 * frase, que promete una facultad inexistente, o a la que se le ha caído la línea que prohíbe
 * diagnosticar.
 */
import { describe, it, expect } from "vitest";
import {
  BUILTIN_SKILLS,
  BUILTIN_INSTRUCTIONS_MAX,
  BUILTIN_SKILL_SOURCE,
  builtinSkillByName,
  type BuiltinSkill,
} from "@/lib/skills/builtin-catalog";

describe("catálogo de skills propias — forma", () => {
  it("AC1 — toda skill propia trae instrucciones curadas no vacías", () => {
    // Es el change entero en una línea: sin esto `usar_skill` devuelve `curated: false` y le
    // suelta al modelo la descripción de catálogo, que es la situación que veníamos a
    // arreglar.
    expect(BUILTIN_SKILLS.length).toBeGreaterThan(0);
    for (const s of BUILTIN_SKILLS) {
      expect(s.instructions.trim(), s.name).not.toBe("");
      expect(s.description.trim(), s.name).not.toBe("");
      expect(s.use, s.name).toBe(s.use.toUpperCase());
    }
  });

  it("los nombres son únicos y llevan el prefijo `3a/`", () => {
    // `Skill.name` es @unique en la base: un duplicado aquí no daría un error claro, daría
    // un upsert que pisa la anterior y una skill que desaparece sin ruido.
    const names = BUILTIN_SKILLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n, n).toMatch(/^3a\//);
  });

  it("AC7 — ninguna supera el tope que aplica `usar_skill`", () => {
    // El executor trunca a `SKILL_INSTRUCTIONS_MAX` sin avisar al modelo. Cortar un protocolo
    // por la mitad puede llevarse por delante justo la parte final, que es donde están las
    // instrucciones de escalado.
    for (const s of BUILTIN_SKILLS) {
      expect(s.instructions.length, `${s.name} (${s.instructions.length} car.)`).toBeLessThan(
        BUILTIN_INSTRUCTIONS_MAX
      );
    }
  });

  it("AC4 — ninguna declara `toolsProvider`: nacen informativas", () => {
    // Declarar un proveedor sin la integración física conectada hace que
    // `capabilitiesForSkills` las marque `requires_connection`, y la UI prometería una
    // facultad que no existe. En producción hay 0 integraciones conectadas.
    for (const s of BUILTIN_SKILLS) {
      expect(Object.keys(s), s.name).not.toContain("toolsProvider");
      expect(Object.keys(s), s.name).not.toContain("mcpUrl");
    }
  });

  it("la descripción dice CUÁNDO usar la skill", () => {
    // La descripción es lo único que el modelo ve en el índice del prompt antes de decidir
    // si invoca `usar_skill`. Si no dice cuándo aplicarla, el cuerpo curado no se carga
    // jamás y todo el trabajo de instrucciones queda muerto.
    for (const s of BUILTIN_SKILLS) {
      expect(s.description.toLowerCase(), s.name).toContain("úsala");
    }
  });

  it("`builtinSkillByName` encuentra por nombre exacto y no por aproximación", () => {
    const first = BUILTIN_SKILLS[0];
    expect(builtinSkillByName(first.name)).toBe(first);
    expect(builtinSkillByName(first.name.toUpperCase())).toBeUndefined();
    expect(builtinSkillByName("3a/no-existe")).toBeUndefined();
  });

  it("`BUILTIN_SKILL_SOURCE` es el valor que distingue lo nuestro de lo importado", () => {
    // El seed sólo escribe sobre filas con este `source` y la purga sólo borra las que no lo
    // tienen. Si este valor cambia, las dos guardas dejan de proteger nada.
    expect(BUILTIN_SKILL_SOURCE).toBe("builtin");
  });
});

describe("catálogo de skills propias — cobertura", () => {
  const has = (use: string) => BUILTIN_SKILLS.filter((s) => s.use === use);

  it("AC8 — cada vertical que vendemos tiene al menos una skill", () => {
    // Los verticales salen de `front/lib/promptTemplates.ts`: E-commerce, Inmobiliaria,
    // Salud y Legal. Vender un vertical sin skill propia es vender el catálogo vacío.
    for (const use of ["ECOMMERCE", "INMOBILIARIA", "SALUD", "LEGAL"]) {
      expect(has(use).length, use).toBeGreaterThan(0);
    }
  });

  it("hay skills transversales, no sólo verticales", () => {
    // La mayoría de tenants (peluquería, taller, gestoría) no encaja en ningún vertical con
    // plantilla. Si sólo hubiera verticales, para ellos el catálogo seguiría vacío.
    const transversales = BUILTIN_SKILLS.filter((s) =>
      ["RESERVAS", "VENTAS", "ATENCION", "CUMPLIMIENTO"].includes(s.use)
    );
    expect(transversales.length).toBeGreaterThanOrEqual(4);
  });
});

describe("catálogo de skills propias — límites de responsabilidad", () => {
  const byName = (n: string): BuiltinSkill => {
    const s = builtinSkillByName(n);
    if (!s) throw new Error(`Falta la skill ${n}`);
    return s;
  };

  it("AC9 — la skill de Salud prohíbe diagnosticar y manda a urgencias", () => {
    // No es una formalidad. Sin estas líneas el modelo improvisa ante un síntoma, y ahí el
    // daño no es un cliente descontento.
    const body = byName("3a/citas-y-triaje-no-clinico").instructions.toLowerCase();
    expect(body).toContain("no diagnostiques");
    expect(body).toContain("112");
    expect(body).toMatch(/no interpretes resultados/);
    expect(body).toMatch(/no recomiendes tratamientos/);
  });

  it("AC9 — la skill Legal prohíbe asesorar y confirmar plazos", () => {
    // Un plazo de prescripción mal dicho puede costarle un derecho a alguien. Es el daño más
    // grave que puede hacer un agente de un despacho.
    const body = byName("3a/primera-consulta-legal").instructions.toLowerCase();
    expect(body).toContain("no des asesoramiento jurídico");
    expect(body).toMatch(/no confirmes plazos/);
  });

  it("las skills de dinero prohíben inventarse importes", () => {
    const precios = byName("3a/precios-y-presupuestos").instructions.toLowerCase();
    expect(precios).toMatch(/no lo estimes|no existe/);

    const quejas = byName("3a/quejas-y-reclamaciones").instructions.toLowerCase();
    expect(quejas).toMatch(/no prometas compensaciones/);
  });

  it("la skill de datos personales prohíbe pedir credenciales", () => {
    const body = byName("3a/datos-personales-en-el-chat").instructions.toLowerCase();
    expect(body).toMatch(/contraseñas/);
    expect(body).toMatch(/tarjeta/);
  });

  it("la skill de reservas prohíbe confirmar huecos sin comprobarlos", () => {
    // Es el fallo clásico: el modelo dice "te lo he reservado" sin haber tocado ninguna
    // agenda, y el cliente se presenta.
    const body = byName("3a/reserva-de-cita").instructions.toLowerCase();
    expect(body).toMatch(/no confirmes una hora que no hayas comprobado/);
  });
});
