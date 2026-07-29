import { prisma } from "@/lib/db";
import { openai, DEFAULT_MODEL } from "@/lib/openai";
import { scrapeUrl, discoverPages } from "@/lib/scraper/web";
import { normalizeType, normalizeUse } from "@/lib/github-skills/scraper";

const MAX_PAGES = 5;
const MAX_CHARS_PER_PAGE = 8000;
const MAX_COMPONENTS = 25;

interface ExtractedComponent {
  name: string;
  description: string;
  type: string;
  use: string;
  tools?: { name: string; description: string }[];
}

/** Extrae componentes (skills, agentes, MCPs...) del texto de una web usando IA. */
async function extractComponents(url: string, content: string): Promise<ExtractedComponent[]> {
  const completion = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    max_completion_tokens: 3000,
    messages: [
      {
        role: "system",
        content:
          "Eres un extractor de catálogo. Del texto de una web identificas herramientas de IA reutilizables: " +
          "skills, agentes, extensiones, plugins y servidores MCP. Devuelves SOLO un array JSON válido, sin markdown. " +
          'Cada elemento: {"name": string única y corta, "description": string en español (1-2 frases), ' +
          '"type": "SKILL"|"AGENT"|"EXTENSION"|"PLUGIN"|"MCP", "use": categoría funcional en MAYÚSCULAS ' +
          '(p.ej. EMAIL, VENTAS, CALENDARIO, DESARROLLO, SOPORTE, GENERAL), ' +
          '"tools": array opcional de {"name","description"} con las capacidades concretas que menciona la web. ' +
          "Si la web no describe ninguna herramienta de IA, devuelve []. No inventes herramientas que no aparezcan.",
      },
      {
        role: "user",
        content: `Web: ${url}\n\nContenido:\n${content}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "[]";
  // El modelo puede envolver el JSON en ```json ... ```
  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_COMPONENTS) : [];
  } catch {
    return [];
  }
}

/**
 * Scrapea una web (página principal + enlaces internos) y registra en el
 * marketplace las skills/agentes/MCPs que describa. Upsert por nombre.
 */
export async function importSkillsFromWebsite(url: string) {
  // `discoverPages` ya devuelve la lista deduplicada, ordenada por relevancia, con la URL
  // de aterrizaje primera y recortada al tope que se le pase.
  const pages = await discoverPages(url, MAX_PAGES).catch(() => [url]);

  const texts: string[] = [];
  for (const page of pages) {
    try {
      texts.push(await scrapeUrl(page));
    } catch {
      // página inaccesible: seguir con el resto
    }
  }
  if (texts.length === 0) throw new Error("No se pudo extraer contenido de la web");

  const content = texts.join("\n\n---\n\n").slice(0, MAX_PAGES * MAX_CHARS_PER_PAGE);
  const components = await extractComponents(url, content);

  let created = 0;
  let updated = 0;
  for (const component of components) {
    if (!component?.name || !component?.description) continue;
    const data = {
      description: String(component.description).slice(0, 500),
      type: normalizeType(component.type),
      use: normalizeUse(component.use),
      tools: JSON.parse(JSON.stringify(component.tools ?? [])),
      repoUrl: url,
      source: "web",
    };
    const existing = await prisma.skill.findUnique({ where: { name: component.name } });
    if (existing) {
      await prisma.skill.update({ where: { name: component.name }, data });
      updated++;
    } else {
      await prisma.skill.create({ data: { name: String(component.name).slice(0, 120), ...data } });
      created++;
    }
  }

  return { url, pagesScanned: texts.length, found: components.length, created, updated };
}
