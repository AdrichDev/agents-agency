/**
 * Espejo client-side del catálogo de skills (AD1, §7.2 design).
 * Solo para badges informativos en el wizard — no decide ejecutabilidad.
 * La fuente de verdad ejecutable es el back (skillStatus en GET /api/agents/:id).
 */

/** Skill.use (UPPERCASE) → proveedor lógico */
export const SKILL_USE_TO_PROVIDER: Record<string, string> = {
  CALENDARIO: "calendar",
  CALENDAR: "calendar",
  EMAIL: "gmail",
  GMAIL: "gmail",
  SLACK: "slack",
  NOTION: "notion",
};

/** Override por substring del name (case-insensitive). Gana sobre use. */
export const NAME_OVERRIDES: Array<{ match: string; provider: string }> = [
  { match: "calendar", provider: "calendar" },
  { match: "calendario", provider: "calendar" },
  { match: "gmail", provider: "gmail" },
  { match: "slack", provider: "slack" },
  { match: "notion", provider: "notion" },
];

export interface SkillLike {
  name: string;
  use: string;
}

/** Devuelve el proveedor lógico de una skill, o null si es informativa. */
export function logicalProviderForSkill(skill: SkillLike): string | null {
  const nameLower = (skill.name ?? "").toLowerCase();
  const override = NAME_OVERRIDES.find((o) => nameLower.includes(o.match));
  if (override) return override.provider;
  const use = (skill.use ?? "").toUpperCase();
  return SKILL_USE_TO_PROVIDER[use] ?? null;
}

/** Etiqueta legible para el badge del wizard ("Necesitará conexión calendar"). */
export function connectionBadgeLabel(skill: SkillLike): string | null {
  const provider = logicalProviderForSkill(skill);
  if (!provider) return null;
  return `Necesitará conexión ${provider}`;
}
