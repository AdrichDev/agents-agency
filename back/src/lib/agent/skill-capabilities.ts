import { TOOLS_BY_PROVIDER } from "@/lib/agent/tools";
import { toPhysicalProvider } from "@/lib/integrations/service-map";
import type { ToolDefinition } from "@/lib/agent/types";

/** Skill.use (UPPERCASE) → proveedor lógico de TOOLS_BY_PROVIDER */
const SKILL_USE_TO_PROVIDER: Record<string, string> = {
  CALENDARIO: "calendar",
  CALENDAR: "calendar",
  EMAIL: "gmail",
  GMAIL: "gmail",
  SLACK: "slack",
  NOTION: "notion",
  ECOMMERCE: "ecommerce",
  ORDER_STATUS: "ecommerce",
};

/** Override por substring del name (case-insensitive). Gana sobre use. */
const NAME_OVERRIDES: Array<{ match: string; provider: string }> = [
  { match: "calendar", provider: "calendar" },
  { match: "calendario", provider: "calendar" },
  { match: "gmail", provider: "gmail" },
  { match: "slack", provider: "slack" },
  { match: "notion", provider: "notion" },
  { match: "pedido", provider: "ecommerce" },
  { match: "order", provider: "ecommerce" },
];

export interface SkillInput {
  id: string;
  name: string;
  use: string;
}

/** Resuelve el proveedor lógico de UNA skill, o null si es informativa. */
export function logicalProviderForSkill(skill: SkillInput): string | null {
  const nameLower = (skill.name ?? "").toLowerCase();
  const override = NAME_OVERRIDES.find((o) => nameLower.includes(o.match));
  if (override) return override.provider;
  const use = (skill.use ?? "").toUpperCase();
  return SKILL_USE_TO_PROVIDER[use] ?? null;
}

export interface SkillCapabilities {
  /** Proveedores lógicos ejecutables (su físico está conectado) */
  executableProviders: string[];
  /** Skills mapeadas cuyo físico NO está conectado */
  missingConnections: Array<{ skillId: string; name: string; provider: string; physical: string }>;
  /** Skills sin entrada en el catálogo (siguen siendo informativas) */
  informationalSkills: Array<{ skillId: string; name: string }>;
}

/**
 * Función PURA. connectedProviders = providers FÍSICOS de agent.integrations.
 * No toca Prisma ni red.
 */
export function capabilitiesForSkills(
  skills: SkillInput[],
  connectedProviders: string[]
): SkillCapabilities {
  const connected = new Set(connectedProviders);
  const executableSet = new Set<string>();
  const missing: SkillCapabilities["missingConnections"] = [];
  const info: SkillCapabilities["informationalSkills"] = [];

  for (const s of skills) {
    const logical = logicalProviderForSkill(s);
    if (!logical) {
      info.push({ skillId: s.id, name: s.name });
      continue;
    }
    const physical = toPhysicalProvider(logical); // calendar → google
    if (connected.has(physical)) {
      executableSet.add(logical);
    } else {
      missing.push({ skillId: s.id, name: s.name, provider: logical, physical });
    }
  }

  return {
    executableProviders: [...executableSet],
    missingConnections: missing,
    informationalSkills: info,
  };
}

/** Tools derivadas de las skills ejecutables (sin KNOWLEDGE_TOOL, sin dedup global). */
export function toolsForSkillProviders(executableProviders: string[]): ToolDefinition[] {
  const out: ToolDefinition[] = [];
  for (const lp of executableProviders) {
    out.push(...(TOOLS_BY_PROVIDER[lp] ?? []));
  }
  return out;
}

export interface SkillStatusItem {
  skillId: string;
  name: string;
  state: "executable" | "requires_connection" | "informational";
  provider?: string; // físico, solo en requires_connection (p.ej. "google")
}

/**
 * Deriva el shape de UI para el GET /api/agents/:id.
 * Retrocompatible: skills vacío → array vacío.
 */
export function buildSkillStatus(
  skills: SkillInput[],
  connectedProviders: string[]
): SkillStatusItem[] {
  if (skills.length === 0) return [];
  const caps = capabilitiesForSkills(skills, connectedProviders);
  const items: SkillStatusItem[] = [];

  for (const s of skills) {
    const logical = logicalProviderForSkill(s);
    if (!logical) {
      items.push({ skillId: s.id, name: s.name, state: "informational" });
      continue;
    }
    const physical = toPhysicalProvider(logical);
    const isExec = caps.executableProviders.includes(logical);
    if (isExec) {
      items.push({ skillId: s.id, name: s.name, state: "executable" });
    } else {
      items.push({ skillId: s.id, name: s.name, state: "requires_connection", provider: physical });
    }
  }

  return items;
}
