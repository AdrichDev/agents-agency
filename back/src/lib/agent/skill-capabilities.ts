import { TOOLS_BY_PROVIDER } from "@/lib/agent/tools";
import { toPhysicalProvider } from "@/lib/integrations/service-map";
import type { ToolDefinition } from "@/lib/agent/types";

/**
 * Contrato EXPLÍCITO skill → facultad (aa-skills-executable-contract, F1).
 *
 * Una skill es ejecutable si y solo si declara `toolsProvider` con una clave
 * válida del catálogo TOOLS_BY_PROVIDER (gmail, slack, calendar, notion,
 * ecommerce). NULL o clave desconocida → skill informativa (solo aporta texto
 * al system prompt).
 *
 * Se ELIMINAN las heurísticas legadas (mapa Skill.use → provider y overrides
 * por substring del nombre): decidían facultades por coincidencia de texto,
 * de modo que renombrar una skill cambiaba silenciosamente sus capacidades y
 * las skills escrapeadas del marketplace jamás podían ser ejecutables. Ahora
 * `use` vuelve a ser solo etiqueta de catálogo para filtros de UI, y la
 * facultad se declara/cura explícitamente (PATCH /api/skills/:id/tools-provider).
 * El backfill del catálogo existente se hizo una única vez en la migración
 * prisma/manual/migrate-skill-tools-provider.sql aplicando la heurística vieja.
 */

export interface SkillInput {
  id: string;
  name: string;
  use: string;
  /** Clave de TOOLS_BY_PROVIDER declarada en la skill (BD); null/ausente = informativa. */
  toolsProvider?: string | null;
  /** Servidor MCP curado de la skill (F2b); null/ausente = sin tools MCP externas. */
  mcpUrl?: string | null;
  /** true si la AgentSkill tiene secreto MCP per-agente cifrado (F2b). */
  hasMcpSecret?: boolean;
}

/** Resuelve el proveedor lógico de UNA skill, o null si es informativa. */
export function logicalProviderForSkill(skill: SkillInput): string | null {
  const declared = skill.toolsProvider;
  if (!declared) return null;
  // Clave desconocida (typo, provider retirado del catálogo) → informativa,
  // nunca romper el chat por metadata inválida.
  return Object.prototype.hasOwnProperty.call(TOOLS_BY_PROVIDER, declared) ? declared : null;
}

export interface SkillCapabilities {
  /** Proveedores lógicos ejecutables (su físico está conectado) */
  executableProviders: string[];
  /** Skills mapeadas cuyo físico NO está conectado */
  missingConnections: Array<{ skillId: string; name: string; provider: string; physical: string }>;
  /** Skills sin facultad declarada (siguen siendo informativas) */
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
  /**
   * Estado de la capa MCP externa (F2b), ADITIVO al `state` de instrucción/provider:
   * `enabled` → la skill declara servidor MCP y hay secreto per-agente (badge
   * "instrucción + MCP"); `pending` → declara servidor pero falta el secreto
   * (badge "MCP pendiente"). Ausente = la skill no declara MCP. Nunca inerte: sin
   * MCP la skill sigue ejecutable a nivel instrucción vía `state`.
   */
  mcp?: "enabled" | "pending";
}

/**
 * Deriva el badge MCP (F2b) de una skill de forma PURA a partir de su config:
 * declara `mcpUrl` + tiene secreto per-agente → "enabled"; declara `mcpUrl` sin
 * secreto → "pending"; sin `mcpUrl` → undefined. El kill switch/allowlist se
 * evalúan fail-soft en runtime (engine/executor); el badge refleja la config
 * curada, no el toggle de despliegue.
 */
export function mcpBadgeForSkill(skill: SkillInput): "enabled" | "pending" | undefined {
  if (!skill.mcpUrl) return undefined;
  return skill.hasMcpSecret ? "enabled" : "pending";
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
    // Badge MCP (F2b) ADITIVO: se adjunta con `mcp` sea cual sea el `state` de
    // instrucción/provider — una skill informativa puede además exponer MCP.
    const mcp = mcpBadgeForSkill(s);
    const logical = logicalProviderForSkill(s);
    if (!logical) {
      items.push({ skillId: s.id, name: s.name, state: "informational", ...(mcp ? { mcp } : {}) });
      continue;
    }
    const physical = toPhysicalProvider(logical);
    const isExec = caps.executableProviders.includes(logical);
    if (isExec) {
      items.push({ skillId: s.id, name: s.name, state: "executable", ...(mcp ? { mcp } : {}) });
    } else {
      items.push({
        skillId: s.id,
        name: s.name,
        state: "requires_connection",
        provider: physical,
        ...(mcp ? { mcp } : {}),
      });
    }
  }

  return items;
}
