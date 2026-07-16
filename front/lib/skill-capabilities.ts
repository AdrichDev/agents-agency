/**
 * Badges de skills en el wizard (F1 aa-skills-executable-contract).
 * Solo informativo — la fuente de verdad ejecutable es el back
 * (skillStatus en GET /api/agents/:id).
 *
 * El espejo de heurísticas legadas (mapa use → provider + overrides por
 * substring del nombre) se eliminó: la facultad ahora viene DECLARADA en la
 * propia skill (campo `toolsProvider`, servido por GET /api/skills), así el
 * front no puede divergir del back.
 */

export interface SkillLike {
  name: string;
  use: string;
  /** Facultad declarada en la skill (clave del catálogo de tools) o null/ausente = informativa. */
  toolsProvider?: string | null;
}

/** Devuelve el proveedor lógico declarado de una skill, o null si es informativa. */
export function logicalProviderForSkill(skill: SkillLike): string | null {
  return skill.toolsProvider ?? null;
}

/** Etiqueta legible para el badge del wizard ("Necesitará conexión calendar"). */
export function connectionBadgeLabel(skill: SkillLike): string | null {
  const provider = logicalProviderForSkill(skill);
  if (!provider) return null;
  return `Necesitará conexión ${provider}`;
}
