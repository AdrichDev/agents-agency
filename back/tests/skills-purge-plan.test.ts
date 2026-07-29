/**
 * T1.2 (aa-catalogo-skills-purga) — El plan de purga.
 *
 * Es un borrado en producción y no tiene deshacer más allá del backup. Lo que estos casos
 * defienden no es "borra bien": es que el plan se NIEGUE a ejecutarse en cuanto el catálogo
 * no sea el que se auditó. Un plan que borra igual ante un nombre que no cuadra es peor que
 * no tener plan.
 */
import { describe, it, expect } from "vitest";
import {
  planSkillPurge,
  isPurgeSafe,
  KEEP_SKILL_NAMES,
  type SkillPurgeCandidate,
} from "@/lib/skills/purge-plan";
import { BUILTIN_SKILLS, BUILTIN_SKILL_SOURCE } from "@/lib/skills/builtin-catalog";

/** Una fila importada. Es el caso por defecto: el catálogo son 108 filas de GitHub. */
const s = (name: string, agentCount = 0, source = "github"): SkillPurgeCandidate => ({
  id: `id_${name}`,
  name,
  source,
  agentCount,
});

/** Las diez skills propias tal y como están hoy en la base, con su `source`. */
const propias = (): SkillPurgeCandidate[] =>
  BUILTIN_SKILLS.map((b) => s(b.name, 0, BUILTIN_SKILL_SOURCE));

/** El catálogo completo de supervivientes, tal y como está en producción. */
const allKeepers = () => KEEP_SKILL_NAMES.map((n) => s(n));

describe("planSkillPurge — reparto", () => {
  it("separa conservadas de borradas por nombre exacto", () => {
    const plan = planSkillPurge([
      ...allKeepers(),
      s("kubernetes/kubectl-mcp"),
      s("microsoft/playwright-mcp"),
    ]);

    expect(plan.keep).toHaveLength(KEEP_SKILL_NAMES.length);
    expect(plan.remove.map((r) => r.name)).toEqual([
      "kubernetes/kubectl-mcp",
      "microsoft/playwright-mcp",
    ]);
    expect(isPurgeSafe(plan)).toBe(true);
  });

  it("un catálogo entero de conservadas no borra nada", () => {
    const plan = planSkillPurge(allKeepers());
    expect(plan.remove).toEqual([]);
    expect(isPurgeSafe(plan)).toBe(true);
  });

  it("catálogo vacío: nada que borrar, pero faltan TODAS y no es seguro", () => {
    const plan = planSkillPurge([]);
    expect(plan.remove).toEqual([]);
    expect(plan.missing).toHaveLength(KEEP_SKILL_NAMES.length);
    expect(isPurgeSafe(plan)).toBe(false);
  });
});

describe("planSkillPurge — los dos abortos", () => {
  it("una conservada que no está en el catálogo ⇒ missing, y NO es seguro", () => {
    // El caso peligroso de verdad: si la skill se llama distinto de lo que creemos, no
    // aparece en `keep`... y su fila real cae en `remove` sin que nadie lo note. Por eso
    // el aborto es por ausencia del nombre esperado, no por otra señal.
    const victima = KEEP_SKILL_NAMES[0];
    const parcial = allKeepers().filter((k) => k.name !== victima);
    const plan = planSkillPurge([...parcial, s(`${victima}-RENOMBRADA`)]);

    expect(plan.missing).toEqual([victima]);
    expect(plan.remove.map((r) => r.name)).toContain(`${victima}-RENOMBRADA`);
    expect(isPurgeSafe(plan)).toBe(false);
  });

  it("una skill a borrar con instalaciones ⇒ installed, y NO es seguro", () => {
    // Hoy en producción hay 0 filas en `AgentSkill`, pero eso puede cambiar entre que se
    // escribe esto y se ejecuta. Borrar una skill instalada rompería el agente de un
    // cliente que paga.
    const plan = planSkillPurge([...allKeepers(), s("kubernetes/kubectl-mcp", 1)]);

    expect(plan.installed.map((i) => i.name)).toEqual(["kubernetes/kubectl-mcp"]);
    expect(isPurgeSafe(plan)).toBe(false);
  });

  it("que una CONSERVADA esté instalada no bloquea nada", () => {
    // Es lo normal y deseable: `installed` mira sólo lo que se va a borrar.
    const keepers = allKeepers();
    keepers[0].agentCount = 3;
    const plan = planSkillPurge([...keepers, s("kubernetes/kubectl-mcp")]);

    expect(plan.installed).toEqual([]);
    expect(isPurgeSafe(plan)).toBe(true);
  });
});

describe("planSkillPurge — las skills propias no se borran nunca", () => {
  // Regresión de un fallo real, encontrado con las diez propias YA sembradas en producción
  // y la purga aún sin ejecutar. `planSkillPurge` repartía sólo por `KEEP_SKILL_NAMES`, y
  // ninguna de las diez está en esa lista: las diez caían en `remove`. Un `--apply` en ese
  // momento habría borrado justo lo que acabábamos de escribir, sin un solo aviso.
  it("las diez propias van a `keep` sin estar en KEEP_SKILL_NAMES", () => {
    for (const b of BUILTIN_SKILLS) {
      expect(KEEP_SKILL_NAMES, b.name).not.toContain(b.name);
    }

    const plan = planSkillPurge([...allKeepers(), ...propias(), s("kubernetes/kubectl-mcp")]);

    expect(plan.remove.map((r) => r.name)).toEqual(["kubernetes/kubectl-mcp"]);
    for (const b of BUILTIN_SKILLS) {
      expect(plan.keep.map((k) => k.name), b.name).toContain(b.name);
    }
    expect(isPurgeSafe(plan)).toBe(true);
  });

  it("una propia se conserva por `source`, aunque su nombre no le suene a nadie", () => {
    // El caso de la skill que escribamos mañana: nace con `source: "builtin"` y nadie se
    // acuerda de tocar `KEEP_SKILL_NAMES`. Tiene que sobrevivir igual.
    const plan = planSkillPurge([
      ...allKeepers(),
      s("3a/skill-que-aun-no-existe", 0, BUILTIN_SKILL_SOURCE),
    ]);

    expect(plan.remove).toEqual([]);
    expect(isPurgeSafe(plan)).toBe(true);
  });

  it("el `source` no se confunde con las variantes de importación", () => {
    // El catálogo tiene cuatro filas con `source` "github-manual" y "github-extract", que
    // no son ni `github` ni nuestras. Son importaciones igualmente y se borran.
    const plan = planSkillPurge([
      ...allKeepers(),
      s("0GiS0/ghcp-agent-skills", 0, "github-manual"),
      s("0GiS0/ghcp-agent-skills/add-social-media-header", 0, "github-extract"),
    ]);

    expect(plan.remove.map((r) => r.name)).toEqual([
      "0GiS0/ghcp-agent-skills",
      "0GiS0/ghcp-agent-skills/add-social-media-header",
    ]);
  });
});

describe("KEEP_SKILL_NAMES", () => {
  it("no tiene duplicados: un nombre repetido sería un error de curación silencioso", () => {
    expect(new Set(KEEP_SKILL_NAMES).size).toBe(KEEP_SKILL_NAMES.length);
  });

  it("no conserva herramientas de desarrollo ni redes sociales", () => {
    // La vara es una sola: ¿le sirve a un tenant (peluquería, clínica, gestoría)? Estas
    // cuatro estuvieron en la lista y se cayeron al aplicarla. Si alguien las repone,
    // que sea a sabiendas y no de un copy-paste.
    //
    // `rusq/slackdump` se había rescatado por ser el único `toolsProvider` poblado del
    // catálogo. Argumento flojo: el contrato skill→facultad vive en `TOOLS_BY_PROVIDER`
    // (`lib/agent/tools.ts`), no en una fila de la base. Conservar una herramienta de
    // equipo técnico para ilustrar un contrato no es razón para enseñársela a un cliente.
    for (const fuera of [
      "rusq/slackdump",
      "stickerdaniel/linkedin-mcp-server",
      "kubernetes/kubectl-mcp",
      "microsoft/playwright-mcp",
    ]) {
      expect(KEEP_SKILL_NAMES, fuera).not.toContain(fuera);
    }
  });
});
