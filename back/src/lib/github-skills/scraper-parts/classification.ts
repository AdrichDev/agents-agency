export const GH = "https://api.github.com";
export const MAX_DISCOVERY_LIMIT = 1000;
const GITHUB_PAGE_SIZE = 100;

// ──────────────────────────────────────────────────────────────────────────────
// CLASIFICACIÓN: TYPE (naturaleza) + USE (uso funcional)
// Type solo admite 5 valores: SKILL | AGENT | EXTENSION | PLUGIN | MCP
// Use es texto libre en UPPERCASE (EMAIL, DESARROLLO, MENSAJERÍA, ...)
// Orden importa: las reglas más específicas primero.
// ──────────────────────────────────────────────────────────────────────────────

const SKILL_TYPES = ["SKILL", "AGENT", "EXTENSION", "PLUGIN", "MCP"] as const;
export type SkillTypeValue = (typeof SKILL_TYPES)[number];

const TYPE_RULES: [RegExp, SkillTypeValue][] = [
  // MCP explícito (máxima prioridad)
  [/\bmcp\b|model.?context.?protocol|mcp-server|mcp[-_]tool|stdio.*mcp|sse.*mcp/i, "MCP"],

  // Agentes (ES + EN)
  [/\bagent(e?s?)\b|autonomous|autopilot|autoGPT|crew[- ]?ai|langgraph|babyagi/i, "AGENT"],

  // Extensiones (ES + EN)
  [/\bextensi(ó|o)n(es)?\b|\bextensions?\b|\bvscode-ext\b|\bchrome-ext\b|\bbrowser-ext\b|\bextension-pack\b/i, "EXTENSION"],

  // Plugins (ES + EN)
  [/\bplugins?\b|addon|add-on|module[-_\s]?pack/i, "PLUGIN"],
];

const USE_RULES: [RegExp, string][] = [
  [/mail|gmail|outlook|smtp|imap|correo|newsletter/i, "EMAIL"],
  [/slack|discord|telegram|whatsapp|teams\b|mensajer|chat\b|sms/i, "MENSAJERÍA"],
  [/jira|linear|asana|trello|notion|task|project|proyecto|kanban|ticket/i, "GESTIÓN DE PROYECTOS"],
  [/calendar|schedule|meeting|agenda|cita|reuni(ó|o)n|reserva|booking|appointment|event/i, "CALENDARIO"],
  [/database|postgres|mysql|sqlite|mongo|sql|redis|supabase|base de datos/i, "BASES DE DATOS"],
  [/scrap|crawl|playwright|puppeteer|selenium/i, "WEB SCRAPING"],
  [/browser|navegador|chrome\b|firefox/i, "NAVEGADOR"],
  [/filesystem|file|drive|dropbox|s3|storage|archivo|carpeta|document|pdf|excel|spreadsheet|docx/i, "DOCUMENTOS"],
  [/search|brave|serp|b(ú|u)squeda|google search|bing/i, "BÚSQUEDA"],
  [/crm|hubspot|salesforce|lead|ventas|sales/i, "CRM"],
  [/stripe|payment|pago|factura|invoice|billing|account|contab|finance|finanz|bank|trading|crypto/i, "FINANZAS"],
  [/shop|ecommerce|tienda|woocommerce|shopify|amazon|producto/i, "ECOMMERCE"],
  [/map|geo|location|ubicaci(ó|o)n|gps|weather|tiempo|clima/i, "MAPAS Y CLIMA"],
  [/image|imagen|video|audio|m(ú|u)sica|photo|foto|media|youtube|spotify/i, "MULTIMEDIA"],
  [/analytic|anal(í|i)tica|metric|dashboard|report|informe|bi\b|grafana/i, "ANALÍTICA"],
  [/security|seguridad|auth|password|secret|vault|scan|vulnerab/i, "SEGURIDAD"],
  [/llm|openai|anthropic|gemini|embedding|rag\b|prompt|machine.?learning|inteligencia artificial/i, "IA"],
  [/translat|traducc|idioma|language/i, "TRADUCCIÓN"],
  [/social|twitter|linkedin|instagram|facebook|reddit|redes sociales/i, "REDES SOCIALES"],
  [/devops|docker|kubernetes|terraform|aws|azure|gcp|cloud|deploy|ci\/cd|monitor/i, "DEVOPS"],
  [/github|gitlab|git\b|code|repo|vscode|copilot|debug|test/i, "DESARROLLO"],
  [/note|nota|knowledge|wiki|obsidian|memory|apunte/i, "NOTAS"],
  [/rrhh|hr\b|recruit|empleado|n(ó|o)mina|talento/i, "RRHH"],
  [/legal|jur(í|i)dic|contrato|compliance/i, "LEGAL"],
  [/salud|health|m(é|e)dic|fitness|patient/i, "SALUD"],
];

/** Normaliza cualquier valor (de IA o legado) a uno de los 5 tipos válidos. */
export function normalizeType(value: unknown): SkillTypeValue {
  const v = String(value ?? "").trim().toUpperCase();
  if ((SKILL_TYPES as readonly string[]).includes(v)) return v as SkillTypeValue;
  if (/^AGENTE?S?$/.test(v)) return "AGENT";
  if (/^EXTENSION(ES)?S?$/.test(v) || v === "EXTENSIÓN" || v === "EXTENSIONES") return "EXTENSION";
  if (/^PLUGINS?$/.test(v)) return "PLUGIN";
  if (v.includes("MCP")) return "MCP";
  return "SKILL";
}

/** Normaliza el uso funcional a UPPERCASE no vacío. */
export function normalizeUse(value: unknown): string {
  const v = String(value ?? "").trim().toUpperCase();
  return v || "GENERAL";
}

export function detectType(name: string, description: string, extra = ""): SkillTypeValue {
  const text = `${name} ${description} ${extra}`;
  for (const [re, type] of TYPE_RULES) if (re.test(text)) return type;
  return "SKILL";
}

export function detectUse(name: string, description: string, extra = ""): string {
  const text = `${name} ${description} ${extra}`;
  for (const [re, use] of USE_RULES) if (re.test(text)) return use;
  return "GENERAL";
}

/**
 * Detecta texto en escrituras asiáticas (chino, japonés, coreano, tailandés)
 * para excluir repos cuyo contenido no es legible para los clientes.
 * Rangos: CJK + extensión A, kana, katakana half-width, hangul, thai y puntuación CJK.
 */
const ASIAN_SCRIPT_RE = new RegExp(
  "[" +
    "\\u3400-\\u4DBF" + // CJK extensión A
    "\\u4E00-\\u9FFF" + // CJK unificado (chino)
    "\\u3040-\\u30FF" + // hiragana + katakana (japonés)
    "\\u31F0-\\u31FF" + // katakana extensiones fonéticas
    "\\uFF66-\\uFF9F" + // katakana half-width
    "\\uAC00-\\uD7AF" + // hangul (coreano)
    "\\u1100-\\u11FF" + // hangul jamo
    "\\u0E00-\\u0E7F" + // tailandés
    "\\u3000-\\u303F" + // puntuación CJK (。、【】…)
  "]"
);

export function isAsianContent(...texts: (string | null | undefined)[]): boolean {
  return ASIAN_SCRIPT_RE.test(texts.filter(Boolean).join(" "));
}

/**
 * Mapeo de nombres de carpetas/archivos detectados en el árbol del repo
 * al TYPE canónico (ES + EN).
 */
const FOLDER_TYPE_MAP: [RegExp, SkillTypeValue][] = [
  [/^(agentes?|agents?)$/i,               "AGENT"],
  [/^(extensiones?|extensions?)$/i,       "EXTENSION"],
  [/^(plugins?)$/i,                       "PLUGIN"],
  [/^(mcp|mcp[-_]?servers?|servers?)$/i,  "MCP"],
];

/** Detecta el type a partir de los nombres de carpetas raíz del repo. */
export function typeFromTree(entries: string[]): SkillTypeValue | null {
  for (const entry of entries) {
    const base = entry.split("/")[0]; // carpeta o archivo raíz
    for (const [re, type] of FOLDER_TYPE_MAP) {
      if (re.test(base)) return type;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// ANÁLISIS DE READMEs CON IA — tipo compartido
// ──────────────────────────────────────────────────────────────────────────────

export interface AiClassification {
  type: SkillTypeValue;
  use: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// UTILIDADES GITHUB (puras)
// ──────────────────────────────────────────────────────────────────────────────

export function buildGithubSearchPages(limit = MAX_DISCOVERY_LIMIT): { url: string; queryType: string }[] {
  const cappedLimit = Math.max(1, Math.min(limit, MAX_DISCOVERY_LIMIT));

  const queries = [
    { q: "topic:mcp-server", type: "mcp" },
    { q: "topic:model-context-protocol", type: "mcp" },
    { q: "topic:ai-agent", type: "agentes" },
    { q: "topic:ai-agents", type: "agentes" },
    { q: "topic:vscode-extension", type: "extensiones" },
    { q: "topic:chrome-extension", type: "extensiones" },
    { q: "topic:browser-extension", type: "extensiones" },
    { q: "plugin+topic:llm", type: "plugins" },
    { q: "plugin+topic:chatgpt", type: "plugins" }
  ];

  const pages = [];
  const itemsPerQuery = Math.ceil(cappedLimit / queries.length);
  const pagesPerQuery = Math.ceil(itemsPerQuery / GITHUB_PAGE_SIZE);

  for (const qObj of queries) {
    for (let page = 1; page <= pagesPerQuery; page++) {
      pages.push({
        url: `${GH}/search/repositories?q=${qObj.q}&sort=stars&order=desc&per_page=${GITHUB_PAGE_SIZE}&page=${page}`,
        queryType: qObj.type
      });
    }
  }
  return pages;
}

export function normalizeGithubRepo(input: string): { fullName: string; repoUrl: string } {
  const trimmed = input.trim();
  const match = trimmed.match(/^(?:https?:\/\/github\.com\/)?([^/\s]+)\/([^/#?\s]+)(?:[/?#].*)?$/i);
  if (!match) throw new Error("Repositorio de GitHub invalido. Usa owner/repo o https://github.com/owner/repo");

  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  const fullName = `${owner}/${repo}`;

  return {
    fullName,
    repoUrl: `https://github.com/${fullName}`,
  };
}

/** Extrae nombres de tools de un README (bloques `tool_name` y headings). */
export function extractToolsFromReadme(readme: string): { name: string; description: string }[] {
  const tools = new Map<string, string>();
  const bulletRe = /[-*]\s+`([a-z][a-z0-9_]{2,40})`\s*[:—–-]?\s*([^\n]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = bulletRe.exec(readme)) && tools.size < 30) {
    const name = m[1];
    if (/^(npm|npx|pip|uvx?|node|python|docker|json|true|false|http|https)$/i.test(name)) continue;
    tools.set(name, m[2]?.trim().slice(0, 200) ?? "");
  }

  const headingRe = /^#{2,5}\s+`?([a-z][a-z0-9_]{2,40})`?\s*$/gim;
  while ((m = headingRe.exec(readme)) && tools.size < 30) {
    const name = m[1];
    if (
      /^(installation|usage|configuration|license|examples?|tools?|setup|features?|requirements?|development|testing|contributing|overview|api)$/i.test(
        name
      )
    ) {
      continue;
    }
    if (!tools.has(name) && name.includes("_")) tools.set(name, "");
  }

  return [...tools].map(([name, description]) => ({ name, description }));
}

export interface TreeEntry {
  path: string;
  type: string; // "tree" (carpeta) | "blob" (archivo)
}

// ──────────────────────────────────────────────────────────────────────────────
// EXTRACCIÓN DE COMPONENTES
// Los monorepos suelen agrupar sus piezas en carpetas skills/, agents/,
// extensions/, plugins/, mcp/ o servers/. Cada subcarpeta se registra como
// una skill independiente con su TYPE correcto.
// ──────────────────────────────────────────────────────────────────────────────

const COMPONENT_FOLDER_MAP: [RegExp, SkillTypeValue][] = [
  [/^skills?$/i,                          "SKILL"],
  [/^(agents?|agentes?)$/i,               "AGENT"],
  [/^(extensions?|extensiones?)$/i,       "EXTENSION"],
  [/^plugins?$/i,                         "PLUGIN"],
  [/^(mcp|mcp[-_]?servers?|servers?)$/i,  "MCP"],
];

/** Subcarpetas que no son componentes reales. */
const COMPONENT_IGNORE_RE =
  /^[._]|^(node_modules|dist|build|out|tests?|__\w+|docs?|examples?|samples?|scripts?|src|lib|common|shared|utils?|assets|images?|templates?|types?)$/i;

const MAX_COMPONENTS_PER_REPO = 60;

/**
 * Busca carpetas contenedoras (en raíz o a 1 nivel, p.ej. src/agents) y
 * devuelve sus subcarpetas directas como componentes tipados.
 */
export function extractComponentsFromTree(
  tree: TreeEntry[]
): { name: string; path: string; type: SkillTypeValue }[] {
  const dirs = tree.filter((t) => t.type === "tree");
  const components: { name: string; path: string; type: SkillTypeValue }[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    const parts = dir.path.split("/");
    if (parts.length > 2) continue; // contenedores solo en raíz o a 1 nivel
    const base = parts[parts.length - 1];
    const match = COMPONENT_FOLDER_MAP.find(([re]) => re.test(base));
    if (!match) continue;

    const childDepth = parts.length + 1;
    for (const child of dirs) {
      if (!child.path.startsWith(`${dir.path}/`)) continue;
      const childParts = child.path.split("/");
      if (childParts.length !== childDepth) continue;

      const childName = childParts[childParts.length - 1];
      if (COMPONENT_IGNORE_RE.test(childName)) continue;
      if (seen.has(child.path)) continue;
      seen.add(child.path);

      components.push({ name: childName, path: child.path, type: match[1] });
      if (components.length >= MAX_COMPONENTS_PER_REPO) return components;
    }
  }
  return components;
}
