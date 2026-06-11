import { prisma } from "@/lib/db";
import { openai, DEFAULT_MODEL } from "@/lib/openai";

const GH = "https://api.github.com";
const MAX_DISCOVERY_LIMIT = 1000;
const GITHUB_PAGE_SIZE = 100;

function ghHeaders() {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "agent-agency-skills-scraper",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

// ──────────────────────────────────────────────────────────────────────────────
// CATEGORIZACIÓN
// Orden importa: las reglas más específicas primero.
// ──────────────────────────────────────────────────────────────────────────────

const CATEGORY_RULES: [RegExp, string][] = [
  // Agentes (ES + EN)
  [/\bagent(e?s?)\b|autonomous|autopilot|autoGPT|crew[- ]?ai|langgraph|langchain/i, "agentes"],

  // Extensiones (ES + EN)
  [/\bextension(es?)?\b|\bplugin[-_\s]?extension|vscode-ext|chrome-ext|browser-ext/i, "extensiones"],

  // Plugins (ES + EN)
  [/\bplugin(es?)?\b|addon|add-on|widget|module[-_\s]?pack/i, "plugins"],

  // MCP explícito
  [/\bmcp\b|model.?context.?protocol|mcp-server|mcp[-_]tool|stdio.*mcp|sse.*mcp/i, "mcp"],

  // Categorías funcionales (sin solapar con las anteriores)
  [/mail|gmail|outlook|smtp|imap/i, "email"],
  [/slack|discord|telegram|whatsapp|teams\b/i, "mensajería"],
  [/jira|linear|asana|trello|notion|task|project/i, "gestión de proyectos"],
  [/calendar|schedule|meeting/i, "calendario"],
  [/github|gitlab|git\b|code|repo/i, "desarrollo"],
  [/database|postgres|mysql|sqlite|mongo|sql/i, "bases de datos"],
  [/browser|playwright|puppeteer|scrap|crawl|fetch|web/i, "web scraping"],
  [/file|filesystem|drive|dropbox|s3|storage/i, "archivos"],
  [/search|brave|serp/i, "búsqueda"],
  [/crm|hubspot|salesforce|stripe|payment|shop/i, "negocio"],
];

/**
 * Mapeo de nombres de carpetas/archivos detectados en el árbol del repo
 * a las categorías canónicas (ES + EN).
 */
const FOLDER_CATEGORY_MAP: [RegExp, string][] = [
  [/^(agentes?|agents?)$/i,                "agentes"],
  [/^(extensiones?|extensions?)$/i,        "extensiones"],
  [/^(plugins?)$/i,                        "plugins"],
  [/^(mcp|mcp[-_]?servers?|servers?)$/i,  "mcp"],
];

export function categorize(name: string, description: string, extra = ""): string {
  const text = `${name} ${description} ${extra}`;
  for (const [re, cat] of CATEGORY_RULES) if (re.test(text)) return cat;
  return "general";
}

/** Detecta categoría a partir de los nombres de carpetas raíz del repo. */
function categoryFromTree(entries: string[]): string | null {
  for (const entry of entries) {
    const base = entry.split("/")[0]; // carpeta o archivo raíz
    for (const [re, cat] of FOLDER_CATEGORY_MAP) {
      if (re.test(base)) return cat;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// UTILIDADES GITHUB
// ──────────────────────────────────────────────────────────────────────────────

export function buildGithubSearchPages(limit = MAX_DISCOVERY_LIMIT): string[] {
  const cappedLimit = Math.max(1, Math.min(limit, MAX_DISCOVERY_LIMIT));
  const pages = Math.ceil(cappedLimit / GITHUB_PAGE_SIZE);

  return Array.from({ length: pages }, (_, index) => {
    const page = index + 1;
    const perPage = Math.min(GITHUB_PAGE_SIZE, cappedLimit - index * GITHUB_PAGE_SIZE);
    return `${GH}/search/repositories?q=topic:mcp-server&sort=stars&order=desc&per_page=${perPage}&page=${page}`;
  });
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

async function fetchReadme(fullName: string): Promise<string> {
  const res = await fetch(`${GH}/repos/${fullName}/readme`, {
    headers: { ...ghHeaders(), Accept: "application/vnd.github.raw+json" },
  });
  return res.ok ? res.text() : "";
}

async function fetchRepo(fullName: string): Promise<any> {
  const res = await fetch(`${GH}/repos/${fullName}`, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`No se pudo leer ${fullName} desde GitHub`);
  return res.json();
}

/**
 * Obtiene el árbol de archivos de la raíz del repo (1 nivel, sin recursión)
 * para detectar carpetas como agents/, plugins/, extensions/, mcp/.
 */
async function fetchRootTree(fullName: string, defaultBranch = "main"): Promise<string[]> {
  const branches = [defaultBranch, "master", "main"];
  for (const branch of branches) {
    const res = await fetch(`${GH}/repos/${fullName}/contents/`, {
      headers: ghHeaders(),
    }).catch(() => null);

    if (res?.ok) {
      const items: any[] = await res.json();
      if (Array.isArray(items)) return items.map((i) => i.name as string);
    }
    break; // Si falla, no seguir probando ramas para ahorrar rate-limit
  }
  return [];
}

// ──────────────────────────────────────────────────────────────────────────────
// UPSERT CORE
// ──────────────────────────────────────────────────────────────────────────────

async function upsertGithubRepo(
  repo: any,
  options: { category?: string; source?: string } = {}
): Promise<"created" | "updated"> {
  // 1. README → tools + señales de categoría desde contenido
  const readme = await fetchReadme(repo.full_name);
  const tools = extractToolsFromReadme(readme);

  // 2. Árbol raíz → carpetas para detectar categoría
  const rootEntries = await fetchRootTree(repo.full_name, repo.default_branch);
  const treeCategory = categoryFromTree(rootEntries);

  // 3. Señales adicionales: tópicos del repo, README, nombres de carpetas
  const topicsStr = (repo.topics ?? []).join(" ");
  const readmeSnippet = readme.slice(0, 2000); // primeras 2000 chars del README

  // 4. Resolución de categoría (prioridad: manual > árbol > nombre+desc+topics+readme)
  const resolvedCategory =
    options.category ||
    treeCategory ||
    categorize(repo.name, repo.description ?? "", `${topicsStr} ${readmeSnippet}`);

  const data = {
    description: (repo.description ?? "").slice(0, 500) || "MCP server",
    category: resolvedCategory,
    repoUrl: repo.html_url,
    stars: repo.stargazers_count ?? 0,
    tools: tools as any,
    source: options.source ?? "github",
  };

  const existing = await prisma.skill.findUnique({ where: { name: repo.full_name } });

  if (existing) {
    await prisma.skill.update({ where: { name: repo.full_name }, data });
    return "updated";
  }

  await prisma.skill.create({ data: { name: repo.full_name, ...data } });
  return "created";
}

// ──────────────────────────────────────────────────────────────────────────────
// FUNCIONES EXPORTADAS
// ──────────────────────────────────────────────────────────────────────────────

export async function addGithubRepoSkill(
  input: string,
  category?: string
): Promise<{ name: string; created: boolean; updated: boolean }> {
  const { fullName } = normalizeGithubRepo(input);
  const repo = await fetchRepo(fullName);
  const result = await upsertGithubRepo(repo, { category, source: "github-manual" });

  return {
    name: repo.full_name,
    created: result === "created",
    updated: result === "updated",
  };
}

/**
 * Descubre MCPs/skills en GitHub:
 * 1. Repos con topic `mcp-server` ordenados por estrellas, hasta 1000.
 * 2. El registro oficial modelcontextprotocol/servers.
 */
export async function discoverSkills(
  limit = MAX_DISCOVERY_LIMIT
): Promise<{ discovered: number; updated: number; scanned: number }> {
  let discovered = 0;
  let updated = 0;
  let scanned = 0;

  for (const url of buildGithubSearchPages(limit)) {
    const search: any = await fetch(url, { headers: ghHeaders() }).then((r) =>
      r.ok ? r.json() : { items: [] }
    );

    if (!search.items?.length) break;

    for (const repo of search.items) {
      const result = await upsertGithubRepo(repo);
      scanned++;
      if (result === "created") discovered++;
      else updated++;
    }
  }

  // Registro oficial modelcontextprotocol/servers
  const officialReadme = await fetchReadme("modelcontextprotocol/servers");
  const linkRe = /\[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\)\s*[-—–]\s*([^\n]+)/g;
  let m: RegExpExecArray | null;
  let officialCount = 0;
  const cappedLimit = Math.min(limit, MAX_DISCOVERY_LIMIT);

  while ((m = linkRe.exec(officialReadme)) && officialCount < cappedLimit) {
    const [, name, url, description] = m;
    const skillName = url.replace("https://github.com/", "").split(/[#?]/)[0];
    if (!skillName.includes("/")) continue;
    officialCount++;
    scanned++;

    const existing = await prisma.skill.findUnique({ where: { name: skillName } });
    const data = {
      description: description.trim().slice(0, 500),
      category: categorize(name, description),
      repoUrl: url,
      source: "github",
    };
    if (existing) {
      await prisma.skill.update({ where: { name: skillName }, data });
      updated++;
    } else {
      await prisma.skill.create({ data: { name: skillName, stars: 0, tools: [], ...data } });
      discovered++;
    }
  }

  return { discovered, updated, scanned };
}

export async function discoverGoogleSkills(): Promise<{ discovered: number; updated: number; scanned: number }> {
  try {
    const response = await openai.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content: `Devuelve un objeto JSON con el formato:
{
  "skills": [
    {
      "name": "...",
      "description": "...",
      "category": "mcp|agentes|extensiones|plugins|general|email|mensajería|gestión de proyectos|calendario|desarrollo|bases de datos|web scraping|archivos|búsqueda|negocio",
      "repoUrl": "...",
      "stars": 100,
      "tools": [ { "name": "...", "description": "..." } ]
    }
  ]
}
Asigna la categoría correcta según el tipo: servidores MCP → "mcp", agentes autónomos → "agentes", extensiones de navegador/VS Code → "extensiones", plugins de plataforma → "plugins". Incluye servidores MCP oficiales de Google (Drive, Calendar, Maps, YouTube, Gmail, Search) y populares (Brave Search, PostgreSQL, Fetch, Puppeteer, GitHub).`,
        },
        {
          role: "user",
          content:
            "Genera una lista de 15 servidores MCP populares (al menos 6 de Google) con sus herramientas principales en formato JSON. Clasifica cada uno en la categoría correcta.",
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content || "{}";
    const parsed = JSON.parse(content);
    const skillsList = parsed.skills || parsed.servers || parsed.items || (Array.isArray(parsed) ? parsed : []);

    let discovered = 0;
    let updated = 0;
    let scanned = 0;

    for (const item of skillsList) {
      if (!item.name) continue;
      scanned++;

      // También aplicamos categorize() como fallback si la IA no lo puso bien
      const resolvedCat =
        item.category && item.category !== "general"
          ? item.category
          : categorize(item.name, item.description ?? "");

      const data = {
        description: (item.description || "Google MCP server").slice(0, 500),
        category: resolvedCat,
        repoUrl: item.repoUrl || "https://github.com/modelcontextprotocol/servers",
        stars: Number(item.stars || 100),
        tools: Array.isArray(item.tools) ? item.tools : [],
        source: "google-ai",
      };

      const existing = await prisma.skill.findUnique({ where: { name: item.name } });
      if (existing) {
        await prisma.skill.update({ where: { name: item.name }, data });
        updated++;
      } else {
        await prisma.skill.create({ data: { name: item.name, ...data } });
        discovered++;
      }
    }

    return { discovered, updated, scanned };
  } catch (error) {
    console.error("Error discovering Google skills:", error);
    throw error;
  }
}
