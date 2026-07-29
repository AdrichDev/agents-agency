/**
 * T2.3 (aa-skills-propias-tenant) — El plan de siembra.
 *
 * GWT4: sembrar dos veces tiene que dejar el catálogo igual, y no puede tocar ni una fila
 * importada de GitHub. La forma de romper esto es sutil: un `upsert` por `name` sobre una
 * fila ajena no falla, actualiza — y se lleva por delante una skill del catálogo importado
 * sin dar ningún error. Por eso la guarda es por `source`, no por ausencia del nombre.
 */
import { describe, it, expect } from "vitest";
import {
  BUILTIN_SKILLS,
  BUILTIN_SKILL_SOURCE,
  planBuiltinSeed,
  isSeedSafe,
  type ExistingSkillRow,
} from "@/lib/skills/builtin-catalog";

/** Catálogo ya sembrado: todas las nuestras presentes y con el `source` correcto. */
const yaSembrado = (): ExistingSkillRow[] =>
  BUILTIN_SKILLS.map((s) => ({ id: `id_${s.name}`, name: s.name, source: BUILTIN_SKILL_SOURCE }));

describe("planBuiltinSeed — primera siembra", () => {
  it("catálogo sin ninguna propia: se crean todas y no se actualiza nada", () => {
    const plan = planBuiltinSeed([]);

    expect(plan.create).toHaveLength(BUILTIN_SKILLS.length);
    expect(plan.update).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(isSeedSafe(plan)).toBe(true);
  });

  it("las filas importadas de GitHub no entran en el plan", () => {
    // Sólo se consultan los nombres nuestros; el resto del catálogo ni se mira. Si una skill
    // ajena apareciera en `create` o `update`, la siembra la estaría pisando.
    const plan = planBuiltinSeed([
      { id: "x1", name: "kubernetes/kubectl-mcp", source: "github" },
      { id: "x2", name: "microsoft/playwright-mcp", source: "github" },
    ]);

    expect(plan.create).toHaveLength(BUILTIN_SKILLS.length);
    expect(plan.update).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });
});

describe("planBuiltinSeed — GWT4: idempotencia", () => {
  it("segunda pasada: cero creaciones, todo actualización", () => {
    // Es lo que garantiza que correr el seed dos veces no duplique el catálogo. `Skill.name`
    // es @unique, así que un duplicado real fallaría, pero fallar no es el objetivo:
    // el objetivo es que la segunda pasada actualice el contenido y ya está.
    const plan = planBuiltinSeed(yaSembrado());

    expect(plan.create).toEqual([]);
    expect(plan.update).toHaveLength(BUILTIN_SKILLS.length);
    expect(isSeedSafe(plan)).toBe(true);
  });

  it("cada actualización apunta al id de la fila existente", () => {
    const plan = planBuiltinSeed(yaSembrado());
    for (const u of plan.update) {
      expect(u.id, u.skill.name).toBe(`id_${u.skill.name}`);
    }
  });

  it("siembra parcial: crea las que faltan y actualiza las que ya están", () => {
    // El caso real de añadir una skill nueva al catálogo en un commit posterior.
    const existentes = yaSembrado().slice(0, 3);
    const plan = planBuiltinSeed(existentes);

    expect(plan.update).toHaveLength(3);
    expect(plan.create).toHaveLength(BUILTIN_SKILLS.length - 3);
    expect(isSeedSafe(plan)).toBe(true);
  });
});

describe("planBuiltinSeed — GWT4: la guarda de `source`", () => {
  it("un nombre nuestro ocupado por una fila importada ⇒ conflicto, y NO es seguro", () => {
    // El daño que evita: sin esta guarda el `upsert` actualizaría la fila ajena en silencio.
    // No habría error, no habría log, y una skill del catálogo importado quedaría
    // reemplazada por la nuestra.
    const victima = BUILTIN_SKILLS[0].name;
    const plan = planBuiltinSeed([{ id: "ajena", name: victima, source: "github" }]);

    expect(plan.conflicts).toEqual([{ id: "ajena", name: victima, source: "github" }]);
    expect(plan.update).toEqual([]);
    expect(isSeedSafe(plan)).toBe(false);
  });

  it("un conflicto basta para bloquear la siembra entera, no sólo esa skill", () => {
    // Todo o nada: dejar el catálogo a medio sembrar es peor que no sembrarlo, porque el
    // siguiente que lo mire no sabrá qué versión está viendo.
    const existentes = yaSembrado();
    existentes[4] = { ...existentes[4], source: "github" };
    const plan = planBuiltinSeed(existentes);

    expect(plan.conflicts).toHaveLength(1);
    expect(isSeedSafe(plan)).toBe(false);
  });

  it("un `source` desconocido también cuenta como conflicto", () => {
    // Sólo se escribe sobre lo que es demostrablemente nuestro. Cualquier otro valor —de una
    // importación futura, de una migración— se trata como ajeno.
    const plan = planBuiltinSeed([
      { id: "raro", name: BUILTIN_SKILLS[0].name, source: "marketplace" },
    ]);

    expect(plan.conflicts).toHaveLength(1);
    expect(isSeedSafe(plan)).toBe(false);
  });
});
