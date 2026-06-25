import { prisma } from "@/lib/db";
import { openai, DEFAULT_MODEL } from "@/lib/openai";
import {
  GH,
  MAX_DISCOVERY_LIMIT,
  type SkillTypeValue,
  type AiClassification,
  type TreeEntry,
  normalizeType,
  normalizeUse,
  detectType,
  detectUse,
  isAsianContent,
  typeFromTree,
  extractToolsFromReadme,
  extractComponentsFromTree,
  normalizeGithubRepo,
  buildGithubSearchPages,
} from "@/lib/github-skills/scraper-parts/classification";

function ghHeaders() {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "agent-agency-skills-scraper",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

// ──────────────────────────────────────────────────────────────────────────────
// ANÁLISIS DE READMEs CON IA
// Al pulsar "Importar de GitHub" / "Importar de Google" el modelo analiza los
// README y devuelve TYPE + USE para cada repo. Fallback: reglas regex.
// ──────────────────────────────────────────────────────────────────────────────

const AI_BATCH_SIZE = 15;

/**
 * Clasifica un lote de repos con IA leyendo su README.
 * Devuelve un mapa name → {type, use}. Si la IA falla, mapa vacío (se usará fallback).
 */
async function classifyReadmesWithAI(
  items: { name: string; description: string; readme: string }[]
): Promise<Map<string, AiClassification>> {
  const result = new Map<string, AiClassification>();

  for (let i = 0; i < items.length; i += AI_BATCH_SIZE) {
    const batch = items.slice(i, i + AI_BATCH_SIZE);
    try {
      const completion = await openai.chat.completions.create({
        model: DEFAULT_MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Eres un clasificador experto de herramientas de IA. Para cada repositorio analiza TANTO su "description" COMO su "readme" (ambos campos son igual de importantes; si el readme está vacío, basa la clasificación en la description) y devuelve JSON:
{ "items": [ { "name": "...", "type": "SKILL|AGENT|EXTENSION|PLUGIN|MCP", "use": "..." } ] }
- "type" describe la NATURALEZA de la herramienta. Solo se admiten estos 5 valores exactos:
  MCP = servidor Model Context Protocol; AGENT = agente de IA autónomo; EXTENSION = extensión de navegador/editor; PLUGIN = plugin de una plataforma; SKILL = cualquier otra herramienta/librería funcional.
- "use" describe el USO funcional CONCRETO, en MAYÚSCULAS y en español, una o dos palabras. Sé específico: pregúntate "¿para qué la usaría un negocio?".
  Usos preferidos: EMAIL, MENSAJERÍA, GESTIÓN DE PROYECTOS, CALENDARIO, DESARROLLO, BASES DE DATOS, WEB SCRAPING, NAVEGADOR, DOCUMENTOS, BÚSQUEDA, CRM, FINANZAS, ECOMMERCE, MAPAS Y CLIMA, MULTIMEDIA, ANALÍTICA, SEGURIDAD, IA, TRADUCCIÓN, REDES SOCIALES, DEVOPS, NOTAS, RRHH, LEGAL, SALUD. Usa uno de la lista si encaja; crea otro corto solo si ninguno aplica.
  Ejemplos: "gestionar calendarios y agenda" → CALENDARIO; "sincroniza contactos y leads" → CRM; "genera facturas" → FINANZAS.
- PROHIBIDO usar "GENERAL" si la description o el readme dan CUALQUIER pista del dominio. GENERAL es solo el último recurso cuando no hay absolutamente ninguna información.`,
          },
          {
            role: "user",
            content: JSON.stringify({
              repos: batch.map((b) => ({
                name: b.name,
                description: b.description.slice(0, 300),
                readme: b.readme.slice(0, 1500),
              })),
            }),
          },
        ],
      });

      const parsed = JSON.parse(completion.choices[0].message.content || "{}");
      const list = parsed.items || parsed.repos || [];
      for (const item of list) {
        if (!item?.name) continue;
        result.set(String(item.name), {
          type: normalizeType(item.type),
          use: normalizeUse(item.use),
        });
      }
    } catch (e) {
      console.error("[scraper] IA no disponible para clasificar batch, usando reglas:", e);
    }
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
// UTILIDADES GITHUB (IO)
// ──────────────────────────────────────────────────────────────────────────────

async function fetchReadme(fullName: string): Promise<string> {
  const res = await fetch(`${GH}/repos/${fullName}/readme`, {
    headers: { ...ghHeaders(), Accept: "application/vnd.github.raw+json" },
  });
  return res.ok ? res.text() : "";
}

async function fetchRepo(fullName: string): Promise<any> {
  const res = await fetch(`${GH}/repos/${fullName}`, { headers: ghHeaders() });
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    const resetStr = reset ? ` (se reinicia a las ${new Date(Number(reset) * 1000).toLocaleTimeString("es-ES")})` : "";
    if (remaining === "0") {
      throw new Error(
        `Límite de peticiones de GitHub alcanzado${resetStr}. Añade un GITHUB_TOKEN en back/.env (pasa de 60 a 5000 peticiones/hora) y reinicia el back.`
      );
    }
    throw new Error(`GitHub denegó el acceso a ${fullName} (HTTP ${res.status}). Revisa el GITHUB_TOKEN en back/.env.`);
  }
  if (res.status === 404) {
    throw new Error(`El repositorio ${fullName} no existe o es privado.`);
  }
  if (!res.ok) {
    throw new Error(`GitHub devolvió HTTP ${res.status} al leer ${fullName}.`);
  }
  return res.json();
}

/**
 * Obtiene el árbol COMPLETO del repo en una sola petición (recursive=1).
 * Sirve tanto para detectar el type del repo como para extraer componentes.
 */
async function fetchRepoTree(fullName: string, defaultBranch = "main"): Promise<TreeEntry[]> {
  for (const branch of [...new Set([defaultBranch, "main", "master"])]) {
    const res = await fetch(
      `${GH}/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers: ghHeaders() }
    ).catch(() => null);

    if (res?.ok) {
      const json = (await res.json()) as any;
      if (Array.isArray(json.tree)) return json.tree as TreeEntry[];
    }
  }
  return [];
}

/** Registra cada componente extraído como skill propia (name = owner/repo/componente). */
async function upsertRepoComponents(
  repo: any,
  tree: TreeEntry[],
  parentUse: string
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  const branch = repo.default_branch ?? "main";

  for (const comp of extractComponentsFromTree(tree)) {
    if (isAsianContent(comp.name)) continue; // blindaje anti contenido asiático

    const skillName = `${repo.full_name}/${comp.name}`;
    const ownUse = detectUse(comp.name, "");
    const data = {
      description: `Componente "${comp.name}" (${comp.path}) extraído de ${repo.full_name}. ${(repo.description ?? "").slice(0, 300)}`.trim(),
      type: comp.type,
      use: ownUse !== "GENERAL" ? ownUse : parentUse || "GENERAL",
      repoUrl: `${repo.html_url}/tree/${branch}/${comp.path}`,
      stars: repo.stargazers_count ?? 0,
      tools: [] as any,
      source: "github-extract",
    };

    const existing = await prisma.skill.findUnique({ where: { name: skillName } });
    if (existing) {
      await prisma.skill.update({ where: { name: skillName }, data });
      updated++;
    } else {
      await prisma.skill.create({ data: { name: skillName, ...data } });
      created++;
    }
  }
  return { created, updated };
}

// ──────────────────────────────────────────────────────────────────────────────
// UPSERT CORE
// ──────────────────────────────────────────────────────────────────────────────

async function upsertGithubRepo(
  repo: any,
  options: {
    type?: SkillTypeValue;
    use?: string;
    source?: string;
    ai?: AiClassification | null; // null = ya se intentó IA en lote, no reintentar
    readme?: string;
    fallbackType?: SkillTypeValue;
  } = {}
): Promise<{ status: "created" | "updated"; components: { created: number; updated: number } }> {
  // 1. README → tools + señales de clasificación desde contenido
  const readme = options.readme ?? (await fetchReadme(repo.full_name));
  const tools = extractToolsFromReadme(readme);

  // 2. Árbol completo del repo → detectar type + extraer componentes
  const tree = await fetchRepoTree(repo.full_name, repo.default_branch);
  const rootEntries = tree.filter((t) => !t.path.includes("/")).map((t) => t.path);
  const treeType = typeFromTree(rootEntries);

  // 3. Señales adicionales: tópicos del repo, README, nombres de carpetas
  const topicsStr = (repo.topics ?? []).join(" ");
  const readmeSnippet = readme.slice(0, 2000); // primeras 2000 chars del README

  // 4. Análisis IA del README (si no viene ya pre-calculado en batch; null = no reintentar)
  let ai = options.ai;
  if (ai === undefined && !options.type && !options.use) {
    const aiMap = await classifyReadmesWithAI([
      { name: repo.full_name, description: repo.description ?? "", readme },
    ]);
    ai = aiMap.get(repo.full_name) ?? null;
  }

  // 5. Resolución (prioridad: manual > IA > árbol > hint del query > reglas regex)
  const resolvedType =
    options.type ||
    ai?.type ||
    treeType ||
    options.fallbackType ||
    detectType(repo.name, repo.description ?? "", `${topicsStr} ${readmeSnippet}`);

  // Si la IA devuelve GENERAL, las reglas regex (name + description + topics + readme) tienen otra oportunidad
  const aiUse = ai?.use && ai.use !== "GENERAL" ? ai.use : undefined;
  const resolvedUse =
    options.use ||
    aiUse ||
    detectUse(repo.name, repo.description ?? "", `${topicsStr} ${readmeSnippet}`);

  const data = {
    description: (repo.description ?? "").slice(0, 500) || "MCP server",
    type: resolvedType,
    use: normalizeUse(resolvedUse),
    repoUrl: repo.html_url,
    stars: repo.stargazers_count ?? 0,
    tools: tools as any,
    source: options.source ?? "github",
  };

  const existing = await prisma.skill.findUnique({ where: { name: repo.full_name } });
  let status: "created" | "updated";

  if (existing) {
    await prisma.skill.update({ where: { name: repo.full_name }, data });
    status = "updated";
  } else {
    await prisma.skill.create({ data: { name: repo.full_name, ...data } });
    status = "created";
  }

  // 6. Extraer componentes internos (carpetas skills/, agents/, extensions/, plugins/, mcp/)
  const components = await upsertRepoComponents(repo, tree, data.use);

  return { status, components };
}

// ──────────────────────────────────────────────────────────────────────────────
// FUNCIONES EXPORTADAS
// ──────────────────────────────────────────────────────────────────────────────

export async function addGithubRepoSkill(
  input: string,
  use?: string,
  type?: string
): Promise<{ name: string; created: boolean; updated: boolean; components: number }> {
  const { fullName } = normalizeGithubRepo(input);
  const repo = await fetchRepo(fullName);
  const result = await upsertGithubRepo(repo, {
    use: use ? normalizeUse(use) : undefined,
    type: type ? normalizeType(type) : undefined,
    source: "github-manual",
  });

  return {
    name: repo.full_name,
    created: result.status === "created",
    updated: result.status === "updated",
    components: result.components.created + result.components.updated,
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

  for (const pageObj of buildGithubSearchPages(limit)) {
    const search: any = await fetch(pageObj.url, { headers: ghHeaders() }).then((r) =>
      r.ok ? r.json() : { items: [] }
    );

    if (!search.items?.length) continue;

    // Blindaje: excluir repos con nombre/descripción en escrituras asiáticas
    const filtered = search.items.filter(
      (repo: any) => !isAsianContent(repo.full_name, repo.description)
    );

    // Workflow IA: descargar READMEs y clasificar TYPE + USE en lotes
    const withReadmes: { repo: any; readme: string }[] = [];
    for (const repo of filtered) {
      const readme = await fetchReadme(repo.full_name);
      // Segundo filtro: README mayoritariamente asiático (primeras 1000 chars)
      if (isAsianContent(readme.slice(0, 1000))) continue;
      withReadmes.push({ repo, readme });
    }
    const aiMap = await classifyReadmesWithAI(
      withReadmes.map((w) => ({
        name: w.repo.full_name,
        description: w.repo.description ?? "",
        readme: w.readme,
      }))
    );

    for (const { repo, readme } of withReadmes) {
      const result = await upsertGithubRepo(repo, {
        ai: aiMap.get(repo.full_name) ?? null,
        readme,
        fallbackType: normalizeType(pageObj.queryType),
      });
      scanned++;
      if (result.status === "created") discovered++;
      else updated++;

      // Componentes extraídos del interior del repo
      discovered += result.components.created;
      updated += result.components.updated;
      scanned += result.components.created + result.components.updated;
    }
  }

  // Registro oficial modelcontextprotocol/servers
  const officialReadme = await fetchReadme("modelcontextprotocol/servers");
  const linkRe = /\[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\)\s*[-—–]\s*([^\n]+)/g;
  let m: RegExpExecArray | null;
  const cappedLimit = Math.min(limit, MAX_DISCOVERY_LIMIT);

  // 1) Recolectar entradas del registro
  const officialEntries: { skillName: string; name: string; url: string; description: string }[] = [];
  while ((m = linkRe.exec(officialReadme)) && officialEntries.length < cappedLimit) {
    const [, name, url, description] = m;
    const skillName = url.replace("https://github.com/", "").split(/[#?]/)[0];
    if (!skillName.includes("/")) continue;
    if (isAsianContent(skillName, name, description)) continue; // blindaje anti repos asiáticos
    officialEntries.push({ skillName, name, url, description: description.trim() });
  }

  // 2) Clasificar el USE con IA en lotes (analiza name + description)
  const officialAiMap = await classifyReadmesWithAI(
    officialEntries.map((e) => ({ name: e.skillName, description: `${e.name}: ${e.description}`, readme: "" }))
  );

  // 3) Upsert
  for (const entry of officialEntries) {
    scanned++;
    const ai = officialAiMap.get(entry.skillName);
    const aiUse = ai?.use && ai.use !== "GENERAL" ? ai.use : undefined;

    const existing = await prisma.skill.findUnique({ where: { name: entry.skillName } });
    const data = {
      description: entry.description.slice(0, 500),
      type: "MCP" as const,
      use: aiUse || detectUse(entry.name, entry.description),
      repoUrl: entry.url,
      source: "github",
    };
    if (existing) {
      await prisma.skill.update({ where: { name: entry.skillName }, data });
      updated++;
    } else {
      await prisma.skill.create({ data: { name: entry.skillName, stars: 0, tools: [], ...data } });
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
          content: `Analiza el README/documentación de cada herramienta y devuelve un objeto JSON con el formato:
{
  "skills": [
    {
      "name": "...",
      "description": "...",
      "type": "SKILL|AGENT|EXTENSION|PLUGIN|MCP",
      "use": "EMAIL|MENSAJERÍA|GESTIÓN DE PROYECTOS|CALENDARIO|DESARROLLO|BASES DE DATOS|WEB SCRAPING|NAVEGADOR|DOCUMENTOS|BÚSQUEDA|CRM|FINANZAS|ECOMMERCE|MAPAS Y CLIMA|MULTIMEDIA|ANALÍTICA|SEGURIDAD|IA|TRADUCCIÓN|REDES SOCIALES|DEVOPS|NOTAS|RRHH|LEGAL|SALUD",
      "repoUrl": "...",
      "stars": 100,
      "tools": [ { "name": "...", "description": "..." } ]
    }
  ]
}
- "type" indica la NATURALEZA y solo admite esos 5 valores exactos en MAYÚSCULAS: servidores MCP → "MCP", agentes autónomos → "AGENT", extensiones de navegador/VS Code → "EXTENSION", plugins de plataforma → "PLUGIN", resto → "SKILL".
- "use" indica el USO funcional CONCRETO en MAYÚSCULAS y en español, deducido de la descripción de la herramienta; usa uno de los listados o crea otro corto si ninguno aplica. PROHIBIDO "GENERAL" si la descripción da cualquier pista del dominio.`,
        },
        {
          role: "user",
          content:
            "Genera una lista de 32 herramientas tecnológicas populares distribuidas equitativamente: 8 servidores MCP (incluyendo al menos 4 de Google como Google Drive, Calendar, Gmail o Maps), 8 agentes de IA autónomos (como CrewAI, AutoGPT, BabyAGI, Devin, etc.), 8 extensiones populares de navegador o editores de código (como GitHub Copilot, GitLens, Chrome Web Clipper, etc.) y 8 plugins populares de plataformas (como plugins de Slack, Figma o ChatGPT). Cada elemento debe tener las herramientas (tools) principales que ofrece en formato JSON, su \"type\" exacto ('MCP', 'AGENT', 'EXTENSION' o 'PLUGIN') y su \"use\" funcional en MAYÚSCULAS.",
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
      if (isAsianContent(item.name, item.description)) continue; // blindaje anti repos asiáticos
      scanned++;

      // Fallback con reglas si la IA no clasifica bien
      const resolvedType = item.type
        ? normalizeType(item.type)
        : detectType(item.name, item.description ?? "");
      const resolvedUse =
        item.use && normalizeUse(item.use) !== "GENERAL"
          ? normalizeUse(item.use)
          : detectUse(item.name, item.description ?? "");

      const data = {
        description: (item.description || "Google MCP server").slice(0, 500),
        type: resolvedType,
        use: resolvedUse,
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
