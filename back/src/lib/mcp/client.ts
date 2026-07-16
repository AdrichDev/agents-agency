/**
 * Cliente/pool MCP para skills ejecutables externas (aa-agent-skills-install-execute,
 * F2b / Nivel 2). Extiende el baseline de instrucción con tools REALES de un servidor
 * MCP curado por skill, con estas barreras de seguridad y disponibilidad:
 *
 *  - Kill switch `MCP_SKILLS_ENABLED` (default OFF): con la capa apagada, TODO degrada
 *    al baseline de instrucción — no se listan ni se llaman tools MCP, sin lanzar nunca
 *    al chat (fail-soft). Desplegar el código es inerte hasta activar la env.
 *  - Allowlist de hosts `MCP_SKILL_ALLOWED_HOSTS` (coma-separada): un `mcpUrl` cuyo host
 *    no esté en la lista se rechaza — anti-SSRF a hosts arbitrarios. Sin allowlist NADA
 *    pasa (fail-closed).
 *  - Timeout duro `MCP_SKILL_TIMEOUT_MS` (default 10000): un servidor lento/caído nunca
 *    cuelga el loop agéntico.
 *  - Cache TTL del listado de tools por servidor (evita un round-trip por turno).
 *
 * El SECRETO de acceso es per-agente (AgentSkill.secretEncrypted, descifrado en el
 * executor y pasado aquí como argumento): este cliente NUNCA lee credenciales globales
 * de la plataforma ni de env — el aislamiento entre agentes se cumple aguas arriba.
 *
 * El transporte de red está detrás de la interfaz inyectable `McpTransport` para poder
 * testear allowlist/timeout/kill switch/cache sin un servidor MCP real.
 */

import { logger } from "@/lib/logger";

const DEFAULT_TIMEOUT_MS = 10_000;
const TOOL_LIST_TTL_MS = 60_000;

/** Configuración del servidor MCP de una skill (curada en `Skill.mcpUrl`/`mcpTransport`). */
export interface McpServerConfig {
  url: string;
  /** "http" | "sse"; ausente/desconocido → se trata como http. */
  transport?: string | null;
}

/** Spec de una tool tal como la anuncia el servidor MCP (tools/list). */
export interface McpToolSpec {
  name: string;
  description?: string;
  /** JSON Schema del input de la tool (se reexpone tal cual a OpenAI). */
  inputSchema?: Record<string, unknown>;
}

/**
 * Transporte de red MCP. Se inyecta en tests con un fake para no golpear red real.
 * Ambos métodos reciben un AbortSignal para respetar el timeout duro.
 */
export interface McpTransport {
  listTools(server: McpServerConfig, signal: AbortSignal): Promise<McpToolSpec[]>;
  callTool(
    server: McpServerConfig,
    toolName: string,
    args: unknown,
    secret: string | undefined,
    signal: AbortSignal
  ): Promise<unknown>;
}

// ── Lectura de configuración (env, en cada llamada — permite kill switch en caliente) ──

/** Kill switch: OFF por defecto. Solo "true"/"1" activan la capa MCP. */
export function mcpSkillsEnabled(): boolean {
  const raw = (process.env.MCP_SKILLS_ENABLED ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

function timeoutMs(): number {
  const raw = Number(process.env.MCP_SKILL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/** Hosts permitidos (lowercase, exactos). Vacío → fail-closed (nada pasa). */
export function allowedHosts(): string[] {
  return (process.env.MCP_SKILL_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * true solo si el host de `url` está EXACTAMENTE en la allowlist. URL inválida →
 * false. Sin allowlist → false (fail-closed). Coincidencia exacta de host (sin
 * comodines) para minimizar la superficie de SSRF.
 */
export function isHostAllowed(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const list = allowedHosts();
  if (list.length === 0) return false;
  return list.includes(host);
}

// ── Cache TTL del listado de tools (por url) ───────────────────────────────────

interface CacheEntry {
  exp: number;
  tools: McpToolSpec[];
}
const toolListCache = new Map<string, CacheEntry>();

// ── Transporte por defecto (JSON-RPC 2.0 sobre HTTP; SSE mínimo) ───────────────

/** Extrae el primer objeto JSON-RPC de una respuesta SSE (líneas `data: {...}`). */
function parseSseData(text: string): any {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) {
      const payload = trimmed.slice("data:".length).trim();
      if (payload && payload !== "[DONE]") return JSON.parse(payload);
    }
  }
  throw new Error("Respuesta SSE MCP sin datos JSON-RPC");
}

async function jsonRpc(
  server: McpServerConfig,
  method: string,
  params: Record<string, unknown>,
  secret: string | undefined,
  signal: AbortSignal
): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  // El secreto per-agente viaja como Bearer del servidor MCP curado — nunca una
  // credencial de plataforma.
  if (secret) headers["Authorization"] = `Bearer ${secret}`;

  const res = await fetch(server.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal,
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);

  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  const payload =
    server.transport === "sse" || contentType.includes("text/event-stream")
      ? parseSseData(text)
      : JSON.parse(text);

  if (payload?.error) throw new Error(payload.error?.message ?? "Error MCP");
  return payload?.result ?? {};
}

const defaultHttpTransport: McpTransport = {
  async listTools(server, signal) {
    const result = await jsonRpc(server, "tools/list", {}, undefined, signal);
    const raw = Array.isArray(result?.tools) ? result.tools : [];
    return raw.map((t: any) => ({
      name: String(t?.name ?? ""),
      description: typeof t?.description === "string" ? t.description : undefined,
      inputSchema:
        t?.inputSchema && typeof t.inputSchema === "object" ? (t.inputSchema as Record<string, unknown>) : undefined,
    }));
  },
  async callTool(server, toolName, args, secret, signal) {
    return jsonRpc(server, "tools/call", { name: toolName, arguments: args ?? {} }, secret, signal);
  },
};

let transport: McpTransport = defaultHttpTransport;

/** Inyecta un transporte (tests). No usar en producción. */
export function __setMcpTransport(t: McpTransport): void {
  transport = t;
}

/** Restaura el transporte real y limpia la cache (aislamiento entre tests). */
export function __resetMcpClient(): void {
  transport = defaultHttpTransport;
  toolListCache.clear();
}

// ── Timeout duro (race contra el transporte) ───────────────────────────────────

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const ms = timeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error(`Timeout MCP tras ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([fn(ctrl.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── API pública ────────────────────────────────────────────────────────────────

/**
 * Lista las tools del servidor MCP de una skill (con cache TTL). Fail-soft TOTAL:
 * kill switch OFF, host no permitido, o cualquier error de red/timeout → `[]` (la
 * skill degrada a su baseline de instrucción). Nunca lanza.
 */
export async function listSkillMcpTools(server: McpServerConfig): Promise<McpToolSpec[]> {
  if (!mcpSkillsEnabled()) return [];
  if (!server?.url || !isHostAllowed(server.url)) return [];

  const cached = toolListCache.get(server.url);
  if (cached && cached.exp > Date.now()) return cached.tools;

  try {
    const tools = await withTimeout((signal) => transport.listTools(server, signal));
    toolListCache.set(server.url, { exp: Date.now() + TOOL_LIST_TTL_MS, tools });
    return tools;
  } catch (e) {
    logger.error({ err: e, url: server.url }, "[mcp] listSkillMcpTools falló (fail-soft):");
    return [];
  }
}

/**
 * Invoca una tool del servidor MCP de una skill con el secreto per-agente descifrado.
 * Fail-soft: kill switch OFF, host no permitido, servidor caído o timeout → objeto
 * `{ error }` honesto (el loop lo devuelve al modelo como cualquier error de tool).
 * Nunca lanza dentro del loop agéntico.
 */
export async function callSkillMcpTool(params: {
  server: McpServerConfig;
  toolName: string;
  args: unknown;
  /** Secreto per-agente YA descifrado. Opcional (servidor sin auth). Nunca global. */
  secret?: string;
}): Promise<unknown> {
  const { server, toolName, args, secret } = params;
  if (!mcpSkillsEnabled()) {
    return { error: "Las herramientas MCP de skills están deshabilitadas en esta plataforma." };
  }
  if (!server?.url || !isHostAllowed(server.url)) {
    return { error: "El servidor MCP de esta skill no está en la lista de hosts permitidos." };
  }
  try {
    return await withTimeout((signal) => transport.callTool(server, toolName, args, secret, signal));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ err: e, url: server.url, toolName }, "[mcp] callSkillMcpTool falló (fail-soft):");
    return { error: `La herramienta MCP "${toolName}" no está disponible ahora mismo: ${msg}` };
  }
}

/** Prefijo de namespace de las tools MCP de una skill: `skill__<skillId>__`. */
export const SKILL_MCP_PREFIX = "skill__";

/**
 * Nombre namespaced de una tool MCP: `skill__<skillId>__<tool>`. Se usa el id de la
 * skill (cuid, sin `__`) como slug para que el router del executor lo parsee de forma
 * reversible sin ambigüedad, y para que jamás colisione con las tools de integración.
 */
export function skillMcpToolName(skillId: string, toolName: string): string {
  return `${SKILL_MCP_PREFIX}${skillId}__${toolName}`;
}

/** Parsea un nombre namespaced a `{ skillId, toolName }`, o null si no encaja. */
export function parseSkillMcpToolName(name: string): { skillId: string; toolName: string } | null {
  if (!name.startsWith(SKILL_MCP_PREFIX)) return null;
  const rest = name.slice(SKILL_MCP_PREFIX.length);
  const sep = rest.indexOf("__");
  if (sep <= 0) return null;
  const skillId = rest.slice(0, sep);
  const toolName = rest.slice(sep + 2);
  if (!skillId || !toolName) return null;
  return { skillId, toolName };
}
