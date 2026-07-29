/**
 * aa-catalogo-skills-purga (T1) — Qué skills se quedan y cuáles se van.
 *
 * Contexto. El catálogo tiene 108 skills importadas de GitHub por popularidad. Ninguna se
 * ha instalado nunca en ningún agente (0 filas en `AgentSkill`), sólo una tiene
 * `toolsProvider`, ninguna tiene `instructions` y ninguna tiene `mcpUrl`. Es decir: 107 de
 * las 108 no dan ninguna facultad ejecutable al agente.
 *
 * Por qué borrar y no ocultar. El coste NO es de tokens: `engine.ts` sólo inyecta línea de
 * índice por las skills INSTALADAS, y no hay ninguna instalación, así que hoy las 108 salen
 * gratis en el prompt. El coste es de producto: un catálogo de 108 opciones de las que
 * ninguna hace nada es un catálogo que el operador no usa y que, si lo usa, decepciona —
 * instala una skill, habla con el agente y no pasa absolutamente nada.
 *
 * El criterio, UNO solo: ¿esto le sirve a un TENANT — una peluquería, una clínica, una
 * gestoría? No a un desarrollador, no a nosotros. Con esa vara:
 *   - Fuera las herramientas de programación (kubectl, playwright, linters...): son la
 *     mayoría del catálogo y no pintan nada en el agente de un negocio.
 *   - Fuera las redes sociales.
 *   - Fuera nuestra propia infraestructura de ingesta (scraping, búsqueda web): es cómo
 *     alimentamos el conocimiento, no una facultad que el cliente elija.
 *   - Fuera los verticales que no vendemos (viajes, trading, ERP de manufactura).
 *
 * Aviso sobre el alcance de este fichero: quedarse con 3 no hace vendible el catálogo. Las
 * facultades que de verdad quiere un tenant —reservar, captar leads, consultar pedidos,
 * agenda, correo— YA existen como herramientas ejecutables en `TOOLS_BY_PROVIDER`
 * (`lib/agent/tools.ts`), y ninguna skill importada de GitHub apunta a ellas. Esta purga
 * quita ruido; lo que hace vendible el catálogo son skills propias (`source: "builtin"`)
 * con `instructions` escritas, que es lo que siembra `aa-skills-propias-tenant`.
 *
 * Por eso la conservación tiene DOS reglas, no una. `KEEP_SKILL_NAMES` es una lista cerrada
 * de skills importadas; las propias se conservan por `source`, no por nombre. Si dependieran
 * de la lista, cada skill nueva que escribiéramos nacería marcada para borrar hasta que
 * alguien se acordara de añadirla aquí — y el olvido no daría ningún error, borraría.
 */
import { BUILTIN_SKILL_SOURCE } from "./builtin-catalog";

/**
 * Los nombres son `Skill.name`, que es `@unique`. Coinciden con el identificador de
 * GitHub tal y como lo dejó el importador — se comparan literalmente, sin normalizar:
 * un fallo de coincidencia debe abortar la purga, no borrar de más.
 */
export const KEEP_SKILL_NAMES = [
  // Correo, agenda y documentos del negocio. Es lo que pide de verdad un tenant:
  // "mírame el calendario", "mándale el presupuesto por correo".
  "taylorwilsdon/google_workspace_mcp",
  // Hojas de cálculo: listas de precios, presupuestos, cuadrantes. Es el formato en el
  // que los negocios pequeños tienen sus datos, les guste a ellos o no.
  "haris-musa/excel-mcp-server",
  // Extracción de documentos: facturas y albaranes escaneados.
  "Zipstack/unstract",
] as const;

export interface SkillPurgeCandidate {
  id: string;
  name: string;
  /**
   * Procedencia de la fila. `"builtin"` son las escritas por nosotros y se conservan
   * siempre, sin pasar por `KEEP_SKILL_NAMES`. El resto (`"github"`, `"github-manual"`,
   * `"github-extract"`, o cualquier valor futuro) son importadas.
   */
  source: string;
  /** Instalaciones en agentes. Cualquier valor > 0 aborta la purga entera. */
  agentCount: number;
}

export interface SkillPurgePlan {
  /** Las que se conservan, en el orden en que llegaron. */
  keep: SkillPurgeCandidate[];
  /** Las que se borran. */
  remove: SkillPurgeCandidate[];
  /**
   * Nombres de `KEEP_SKILL_NAMES` que NO están en el catálogo recibido. Si esto no está
   * vacío, el catálogo no es el que se auditó y la purga no debe ejecutarse: puede que
   * la skill se llame distinto y acabe en `remove` por error de nombre.
   */
  missing: string[];
  /** Skills a borrar que tienen instalaciones. Cualquier entrada aborta la purga. */
  installed: SkillPurgeCandidate[];
}

/**
 * Calcula el plan. Función pura: no lee la base de datos ni borra nada. Quien decide
 * ejecutar es `scripts/purge-skill-catalog.ts`, y sólo si `missing` e `installed` están
 * ambos vacíos.
 */
export function planSkillPurge(catalog: SkillPurgeCandidate[]): SkillPurgePlan {
  const keepSet = new Set<string>(KEEP_SKILL_NAMES);
  const present = new Set(catalog.map((s) => s.name));

  const keep: SkillPurgeCandidate[] = [];
  const remove: SkillPurgeCandidate[] = [];
  for (const skill of catalog) {
    // Lo nuestro no se borra nunca. Es la regla que impide que esta purga se lleve por
    // delante las skills propias, que son justo las que hacen vendible el catálogo.
    const conservar = skill.source === BUILTIN_SKILL_SOURCE || keepSet.has(skill.name);
    (conservar ? keep : remove).push(skill);
  }

  return {
    keep,
    remove,
    missing: KEEP_SKILL_NAMES.filter((name) => !present.has(name)),
    // Se mira sobre `remove`, no sobre el catálogo entero: que una skill conservada esté
    // instalada es lo normal y deseable.
    installed: remove.filter((s) => s.agentCount > 0),
  };
}

/** ¿Es seguro ejecutar este plan? Las dos condiciones, juntas y explícitas. */
export function isPurgeSafe(plan: SkillPurgePlan): boolean {
  return plan.missing.length === 0 && plan.installed.length === 0;
}
