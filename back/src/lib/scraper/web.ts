import * as cheerio from "cheerio";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { chunkText } from "@/lib/embeddings";
import { DuplicatePolicy, saveChunkWithDuplicatePolicy } from "@/lib/knowledge-duplicates";
import { safeFetch } from "@/lib/ssrf";

// F3: webs pesadas (p.ej. WordPress/Elementor de ~582 KB) tardan más de 10s en
// descargar. Se sube el timeout por defecto para no tragarse contenido real por
// un aborto prematuro. Parametrizable por argumento en fetchHtml/scrapeUrl.
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

// F1: suelo mínimo de caracteres para fiarse de Readability como "contenido
// principal". Por debajo de este umbral la extracción se considera degradada
// (Readability recuperó apenas un teaser) y se cede al fallback de recall alto.
// Es load-bearing: gobierna el caso "ambos cortos, Readability algo menor".
const READABILITY_MIN_CHARS = 400;

// F1: factor por el que el fallback cheerio debe superar a Readability para
// preferirlo. Readability entrega contenido LIMPIO (sin widgets/sidebars/
// comentarios); solo lo descartamos cuando el fallback lo dobla en tamaño, señal
// de que Readability perdió el cuerpo principal (típico de maquetadores tipo
// Elementor). En un WordPress normal el sidebar/comentarios inflan cheerio solo
// un poco (< 2x), así que gana Readability y el RAG no se contamina.
const FALLBACK_DOMINANCE_FACTOR = 2;

/** Motivo por el que una ingesta acabó sin chunks (F2/F3, estado honesto). */
export type IngestReason = "no_readable_text" | "fetch_failed" | "timeout" | "index_failed";

/** Resultado de ingestWebsite: incluye el motivo si no se indexó nada. */
export interface IngestResult {
  /** Páginas con contenido real indexado (chunks > 0). */
  pages: number;
  /** Páginas visitadas (intentos), con o sin contenido. */
  pagesAttempted: number;
  chunks: number;
  duplicates: number;
  requiresConfirmation: boolean;
  /** Presente solo cuando chunks === 0: por qué no se indexó nada. */
  reason?: IngestReason;
}

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

/**
 * Normaliza texto extraído: colapsa espacios, separa por líneas y DEDUPLICA
 * líneas repetidas exactas. Los maquetadores (Elementor) repiten banners y menús
 * varias veces ("¡Últimas plazas!" x4); la dedup evita inflar el corpus con
 * ruido y mejora los chunks. Cada línea única se separa como párrafo para que
 * chunkText la agrupe.
 */
function normalizeText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[^\S\n]+/g, " ").trim())
    .filter((l) => l.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.join("\n\n").trim();
}

/**
 * Intento principal: extracción del contenido principal con Readability sobre un
 * DOM ligero (linkedom, JS puro, sin binarios). Devuelve null si falla o no hay
 * artículo legible.
 */
function extractWithReadability(html: string): string {
  try {
    const { document } = parseHTML(html);
    // linkedom expone un DOM ligero compatible; el tipo no coincide con lib.dom
    // (no cargada en el back), de ahí el cast controlado.
    const article = new Readability(document as never).parse();
    return article?.textContent?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * Fallback de recall alto: limpia boilerplate estructural (script/estilos/nav/
 * footer/header/form/button + bloques de cookies), inserta saltos en los límites
 * de bloque para poder separar por líneas y devuelve el texto del body.
 */
function extractWithCheerio(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, nav, footer, header, form, button").remove();
  $("[class*=cookie], [id*=cookie], [class*=Cookie]").remove();
  // Insertar saltos en límites de bloque: cheerio .text() concatena sin
  // separadores; sin esto todo el body colapsaría en un único párrafo gigante.
  $("p, div, li, h1, h2, h3, h4, h5, h6, br, tr, section, article, td, blockquote").each((_, el) => {
    $(el).append("\n");
  });
  return $("body").text();
}

/**
 * Convierte HTML en texto principal legible (F1).
 *
 * Estrategia: se ejecutan AMBOS extractores (Readability y heurística cheerio).
 * Por defecto PRIMA Readability porque devuelve el contenido principal LIMPIO
 * (sin sidebars "Entradas recientes"/"Categorías" ni bloques de comentarios que
 * un WordPress normal cuelga fuera de nav/footer/header y que cheerio arrastra).
 * Solo se cede al fallback cheerio (recall alto pero SUCIO) cuando Readability se
 * ha degradado: o bien no alcanza el suelo mínimo (`READABILITY_MIN_CHARS`), o
 * bien el fallback lo dobla en tamaño (`FALLBACK_DOMINANCE_FACTOR`), señal de que
 * perdió el cuerpo del artículo (caso maquetadores tipo Elementor). Elegir "el
 * más largo" contaminaba el RAG en WordPress normales; esta regla lo evita.
 */
export function htmlToText(html: string): string {
  const readabilityText = normalizeText(extractWithReadability(html));
  const cheerioText = normalizeText(extractWithCheerio(html));
  const readabilityDegraded =
    readabilityText.length < READABILITY_MIN_CHARS ||
    cheerioText.length > readabilityText.length * FALLBACK_DOMINANCE_FACTOR;
  if (readabilityDegraded) {
    // Readability no es fiable aquí: quedarse con el texto de mayor recall.
    return cheerioText.length >= readabilityText.length ? cheerioText : readabilityText;
  }
  return readabilityText;
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

/** ¿El error de fetch corresponde a un timeout/abort (vs. un fallo genérico)? */
function isTimeoutError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  return /abort|timeout|timed out/i.test(name) || /abort|timeout|timed out/i.test(msg);
}

/**
 * Scrapea una web y la indexa como conocimiento del agente (F1/F3).
 *
 * F3: deja de tragar los errores por página en silencio. Acumula el motivo del
 * fallo y, si no se indexó ningún chunk, lo propaga vía `reason` para que el
 * estado sea honesto (nunca "indexed" con 0 chunks). Cuenta páginas con
 * contenido real (chunks > 0), no solo intentos.
 */
export async function ingestWebsite(
  agentId: string,
  url: string,
  crawl = true,
  options: {
    duplicatePolicy?: DuplicatePolicy;
    // F1 (progreso indexado): callback opcional de progreso por página. web.ts se
    // mantiene AGNÓSTICO de la BD — solo notifica; quien lo consuma decide si
    // persiste estado. `done` es el nº de páginas ya procesadas (0..total) y
    // `total` el nº total de páginas que se intentarán. Firma opcional →
    // regresión cero: sin callback el comportamiento es idéntico al de hoy.
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<IngestResult> {
  const urls = crawl ? [url, ...(await discoverLinks(url, 8)).filter((u) => u !== url)] : [url];
  const duplicatePolicy = options.duplicatePolicy ?? "ask";
  const onProgress = options.onProgress;
  let chunks = 0;
  let duplicates = 0;
  let pagesWithContent = 0;
  let anyFetchOk = false;
  let anyTimeout = false;
  // F3 (incidente 500 al indexar): flag de fallo al GUARDAR/embeddear un chunk.
  // Un error de embed() (OpenAI) o del INSERT pgvector NO debe tumbar la petición
  // con 500; se degrada a estado honesto ("index_failed") en vez de propagar.
  let anyIndexError = false;
  const failures: string[] = [];

  const attempted = urls.slice(0, 9);
  // `total` se toma del nº real de páginas que se recorrerán (attempted), no de
  // urls.length: garantiza que el último onProgress llega a (total,total) aunque
  // el slice/limit cambien en el futuro.
  const total = attempted.length;
  onProgress?.(0, total);
  for (let idx = 0; idx < attempted.length; idx++) {
    const u = attempted[idx];
    let text: string;
    try {
      text = await scrapeUrl(u);
    } catch (err) {
      // F3: registrar el motivo en vez de tragarlo; clasificar timeout.
      if (isTimeoutError(err)) anyTimeout = true;
      failures.push(err instanceof Error ? err.message : String(err));
      // El progreso avanza aunque la página falle: cada iteración es una página
      // "procesada" (intentada) y el estado debe reflejar el avance real.
      onProgress?.(idx + 1, total);
      continue;
    }
    anyFetchOk = true;
    const pageChunks = chunkText(text);
    if (pageChunks.length > 0) pagesWithContent++;
    for (const chunk of pageChunks) {
      // F3 (incidente 500): el guardado por chunk puede LANZAR (embed() de OpenAI
      // o INSERT pgvector). Se aísla por chunk para no tumbar la ingesta completa:
      // se registra el motivo, se marca anyIndexError y se CONTINÚA. Así un fallo
      // de embeddings degrada a estado honesto en vez de propagar un 500.
      try {
        const result = await saveChunkWithDuplicatePolicy(agentId, u, chunk, duplicatePolicy);
        if (result === "duplicate") duplicates++;
        else chunks++;
      } catch (err) {
        anyIndexError = true;
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }
    onProgress?.(idx + 1, total);
  }

  // F2: derivar el motivo cuando no se indexó nada.
  let reason: IngestReason | undefined;
  if (chunks === 0) {
    if (!anyFetchOk && failures.length > 0) {
      reason = anyTimeout ? "timeout" : "fetch_failed";
    } else if (anyIndexError) {
      // F3 (incidente 500): SÍ había texto legible (se extrajeron chunks) pero el
      // guardado/embedding falló para todos. Estado honesto propio: distinguir
      // "falló el índice" de "no había texto" (no_readable_text) para el front.
      reason = "index_failed";
    } else {
      // Se descargó algo (o no hubo fallo de red) pero no quedó texto legible.
      reason = "no_readable_text";
    }
  }

  return {
    pages: pagesWithContent,
    pagesAttempted: attempted.length,
    chunks,
    duplicates,
    requiresConfirmation: duplicates > 0,
    reason,
  };
}
