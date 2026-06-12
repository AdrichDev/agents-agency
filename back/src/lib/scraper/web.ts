import * as cheerio from "cheerio";
import { chunkText } from "@/lib/embeddings";
import { DuplicatePolicy, saveChunkWithDuplicatePolicy } from "@/lib/knowledge-duplicates";
import { safeFetch } from "@/lib/ssrf";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/** Descarga el HTML crudo de una URL con timeout y guard SSRF. */
export async function fetchHtml(url: string, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<string> {
  const res = await safeFetch(url, {
    headers: { "User-Agent": "AgentAgencyBot/1.0 (+knowledge-ingest)" },
    timeoutMs,
    allowRedirects: true,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al scrapear ${url}`);
  return await res.text();
}

/** Convierte HTML en texto principal (sin scripts, navegación ni estilos). */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript, svg, iframe").remove();
  const text = $("main").text() || $("article").text() || $("body").text();
  return text.replace(/\s{3,}/g, "\n\n").trim();
}

/** Extrae el texto principal de una URL. */
export async function scrapeUrl(url: string, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<string> {
  const html = await fetchHtml(url, timeoutMs);
  return htmlToText(html);
}

/** Descubre enlaces internos de primer nivel para ampliar el scraping. */
export async function discoverLinks(url: string, limit = 10): Promise<string[]> {
  const res = await safeFetch(url, {
    headers: { "User-Agent": "AgentAgencyBot/1.0" },
    allowRedirects: true,
  });
  if (!res.ok) return [];
  const $ = cheerio.load(await res.text());
  const origin = new URL(url).origin;
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    try {
      const href = new URL($(el).attr("href")!, origin);
      if (href.origin === origin && !href.hash && links.size < limit) {
        links.add(href.toString());
      }
    } catch {}
  });
  return [...links];
}

/** Scrapea una web y la indexa como conocimiento del agente. */
export async function ingestWebsite(
  agentId: string,
  url: string,
  crawl = true,
  options: { duplicatePolicy?: DuplicatePolicy } = {}
) {
  const urls = crawl ? [url, ...(await discoverLinks(url, 8)).filter((u) => u !== url)] : [url];
  const duplicatePolicy = options.duplicatePolicy ?? "ask";
  let chunks = 0;
  let duplicates = 0;

  for (const u of urls.slice(0, 9)) {
    try {
      const text = await scrapeUrl(u);
      for (const chunk of chunkText(text)) {
        const result = await saveChunkWithDuplicatePolicy(agentId, u, chunk, duplicatePolicy);
        if (result === "duplicate") duplicates++;
        else chunks++;
      }
    } catch {
      // Pagina inaccesible: continuar con el resto.
    }
  }

  return { pages: urls.length, chunks, duplicates, requiresConfirmation: duplicates > 0 };
}
