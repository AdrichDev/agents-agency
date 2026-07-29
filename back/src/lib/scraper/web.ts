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

/**
 * Tope de páginas por ingesta. Antes era un `slice(0, 9)` sobre los PRIMEROS enlaces del
 * DOM, lo que en una tienda equivale a "el menú de cabecera": envíos, devoluciones,
 * garantía y FAQ viven en el pie y no se descargaban NUNCA. Con el orden por relevancia
 * de `rankCandidateUrls` el tope pasa a gobernar el COSTE, no si la respuesta existe.
 */
export const MAX_PAGES = 25;

/**
 * Sub-sitemaps a seguir dentro de un `<sitemapindex>`. Shopify publica uno por tipo
 * (páginas, productos, colecciones, blogs); con 4 se cubren las páginas de políticas sin
 * descargar catálogos enteros.
 */
const MAX_NESTED_SITEMAPS = 4;

/**
 * ¿Son el mismo sitio? Compara orígenes ignorando el prefijo `www.`.
 *
 * Necesario porque muchos dominios redirigen `dominio.com` → `www.dominio.com`: el sitemap
 * se sirve desde el host final y sus `<loc>` apuntan a `www`, así que un `===` estricto
 * contra el origen pedido los descartaba TODOS, en silencio.
 */
function isSameSite(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.protocol !== ub.protocol || ua.port !== ub.port) return false;
    const strip = (h: string) => h.replace(/^www\./i, "");
    return strip(ua.hostname) === strip(ub.hostname);
  } catch {
    return false;
  }
}

/** Candidato a indexar: URL más el texto del enlace que la señaló (señal de ranking). */
export interface PageCandidate {
  url: string;
  /** Texto del ancla. Vacío para las URLs que vienen del sitemap. */
  anchor: string;
}

/**
 * Palabras que marcan una página de POLÍTICAS o de información de servicio: lo que de
 * verdad pregunta un visitante ("¿cuánto tarda el envío?", "¿puedo devolverlo?").
 * Castellano e inglés porque las tiendas mezclan según el tema/plantilla.
 */
const TIER_1_KEYWORDS = [
  "envio", "envios", "shipping", "delivery", "entrega",
  "devolucion", "devoluciones", "return", "returns", "refund", "reembolso",
  "garantia", "warranty",
  "faq", "preguntas-frecuentes", "preguntas frecuentes", "ayuda", "help",
  "terminos", "condiciones", "terms", "legal", "privacidad", "privacy",
  "contacto", "contact",
  "precio", "precios", "pricing", "tarifas",
];

/** Segundo nivel: contexto del negocio, útil pero no es lo que más se pregunta. */
const TIER_2_KEYWORDS = [
  "sobre-nosotros", "sobre nosotros", "quienes-somos", "quienes somos", "about",
  "servicio", "servicios", "services",
  "reserva", "reservas", "cita", "citas", "booking",
  "horario", "horarios", "hours",
];

/** Normaliza para comparar: minúsculas y sin acentos ("envío" → "envio"). */
function normalizeForMatch(value: string): string {
  // `\p{Diacritic}` en vez de un rango literal de combining marks: el rango se corrompe
  // con facilidad al editar el fichero y el fallo sería silencioso (dejaría de quitar
  // acentos y "envío" no casaría con "envio").
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** `decodeURIComponent` que no lanza con secuencias mal formadas ("%E0%A4%A"). */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Puntúa un candidato. Mayor = se indexa antes. Mira la RUTA y el texto del ancla: una
 * tienda puede enlazar "/policies/refund-policy" con el ancla "Devoluciones" o al revés.
 */
function scoreCandidate(candidate: PageCandidate): number {
  let haystack: string;
  try {
    const u = new URL(candidate.url);
    // `URL.pathname` viene PERCENT-ENCODED: "/envíos" se lee "/env%C3%ADos" y ningún
    // keyword acentuado casaría (el fallo lo destapó el test de acentos, que pasaba en
    // verde por otra palabra). Se decodifica antes de normalizar.
    haystack = normalizeForMatch(`${safeDecode(u.pathname)} ${candidate.anchor}`);
  } catch {
    haystack = normalizeForMatch(`${candidate.url} ${candidate.anchor}`);
  }
  if (TIER_1_KEYWORDS.some((k) => haystack.includes(k))) return 2;
  if (TIER_2_KEYWORDS.some((k) => haystack.includes(k))) return 1;
  return 0;
}

/**
 * Identidad de una página, independiente de cómo se la enlace: host sin `www`, ruta sin
 * barra final. `dominio.com/pages/envio` y `www.dominio.com/pages/envio/` son la MISMA
 * página; indexar las dos gasta cupo y duplica chunks en el índice.
 */
function canonicalKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${u.search}`;
  } catch {
    return url;
  }
}

/** `host/en-eu/pages/x` → `host/pages/x`. `null` si la clave no lleva prefijo de idioma. */
function keyWithoutLocale(key: string): string | null {
  const m = /^([^/]*)\/[a-z]{2}(?:-[a-z]{2})?(\/.+)$/.exec(key);
  return m ? `${m[1]}${m[2]}` : null;
}

/**
 * Ordena los candidatos por relevancia y deduplica.
 *
 * Puro y determinista: `landing` va SIEMPRE primero (es la página que el usuario pidió
 * indexar) y los empates conservan el orden de entrada (orden del DOM), así que el
 * resultado es estable entre ejecuciones.
 */
export function rankCandidateUrls(landing: string, candidates: PageCandidate[]): string[] {
  let landingHost = "";
  try {
    landingHost = new URL(landing).hostname.toLowerCase();
  } catch {}

  const byKey = new Map<string, { url: string; score: number; index: number }>();
  byKey.set(canonicalKey(landing), { url: landing, score: Infinity, index: -1 });

  for (const c of candidates) {
    const key = canonicalKey(c.url);
    const prev = byKey.get(key);
    if (prev) {
      // Misma página por dos hosts: se conserva la forma del dominio que pidió el usuario,
      // para no depender de una redirección extra al descargarla.
      try {
        if (new URL(c.url).hostname.toLowerCase() === landingHost && prev.index >= 0) {
          prev.url = c.url;
        }
      } catch {}
      continue;
    }
    byKey.set(key, { url: c.url, score: scoreCandidate(c), index: byKey.size });
  }

  // Traducciones: Shopify publica cada página también bajo `/en-eu/`, `/fr/`… Con el
  // catálogo legal de una tienda eso son ~10 clones que se comían el tope de páginas.
  // Solo se descarta la variante cuando su original SIN prefijo también está presente:
  // si el sitio vive entero bajo `/es/`, no se pierde nada.
  const scored = [...byKey.entries()]
    .filter(([key]) => {
      const base = keyWithoutLocale(key);
      return !base || !byKey.has(base);
    })
    .map(([, v]) => v)
    .filter((v) => v.index >= 0);

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return [landing, ...scored.map((s) => s.url)];
}

/**
 * Lee `sitemap.xml` (y `sitemap_index.xml`) del origen. Una tienda Shopify/WooCommerce/Wix
 * publica el listado COMPLETO de URLs ahí, así que es una fuente mucho mejor que rastrear
 * el DOM: no depende de que la página de políticas esté enlazada desde la portada.
 *
 * Best-effort por contrato: cualquier fallo de red o XML ilegible devuelve `[]` y la
 * ingesta sigue con los enlaces del DOM. NUNCA lanza.
 */
export async function fetchSitemapUrls(origin: string, maxUrls = 200): Promise<string[]> {
  const seen = new Set<string>();
  const urls: string[] = [];

  /** Descarga un XML y devuelve sus <loc>. `[]` ante cualquier fallo. */
  async function locsOf(target: string): Promise<string[]> {
    try {
      const res = await safeFetch(target, {
        headers: { "User-Agent": "AgentAgencyBot/1.0 (+knowledge-ingest)" },
        timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
        allowRedirects: true,
      });
      if (!res.ok) return [];
      const xml = await res.text();
      return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) =>
        // Los sitemaps escapan los & de la query como &amp;.
        m[1].replace(/&amp;/g, "&")
      );
    } catch {
      return [];
    }
  }

  for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
    let locs: string[];
    try {
      locs = await locsOf(new URL(path, origin).toString());
    } catch {
      continue;
    }
    if (!locs.length) continue;

    // Un `<sitemapindex>` (lo que sirve Shopify en /sitemap.xml) NO contiene páginas:
    // contiene otros sitemaps. Si no se sigue un nivel, el resultado es cero URLs — que
    // es justo lo que pasaba, en silencio, con la tienda de referencia.
    const nested = locs.filter((l) => /\.xml(\?|$)/i.test(l));
    if (nested.length) {
      // Se priorizan los sub-sitemaps de PÁGINAS y políticas: ahí viven envíos,
      // devoluciones y FAQ. Los de productos/colecciones son enormes y aportan poco al
      // conocimiento del negocio, así que van detrás y caen por el tope.
      const ordered = [
        ...nested.filter((l) => /(page|polic|blog)/i.test(l)),
        ...nested.filter((l) => !/(page|polic|blog)/i.test(l)),
      ].slice(0, MAX_NESTED_SITEMAPS);
      for (const sub of ordered) {
        for (const loc of await locsOf(sub)) pushIfSameSite(loc);
        if (urls.length >= maxUrls) break;
      }
    } else {
      for (const loc of locs) pushIfSameSite(loc);
    }

    if (urls.length) break;
  }

  function pushIfSameSite(loc: string): void {
    if (urls.length >= maxUrls) return;
    try {
      const u = new URL(loc);
      if (!isSameSite(u.origin, origin)) return;
      if (/\.xml(\?|$)/i.test(u.pathname)) return;
      const key = u.toString();
      if (seen.has(key)) return;
      seen.add(key);
      urls.push(key);
    } catch {}
  }

  return urls;
}

/**
 * Descubre enlaces internos de primer nivel para ampliar el scraping.
 *
 * Recoge TODOS los enlaces del mismo origen (antes cortaba en los 8 primeros DURANTE la
 * recogida, que es justo lo que descartaba el pie de página). El recorte se aplica luego,
 * sobre la lista ya ordenada por relevancia. Devuelve también el texto del ancla porque
 * es señal de ranking.
 */
export async function discoverLinks(url: string, limit = 200): Promise<PageCandidate[]> {
  const res = await safeFetch(url, {
    headers: { "User-Agent": "AgentAgencyBot/1.0" },
    allowRedirects: true,
  });
  if (!res.ok) return [];
  const $ = cheerio.load(await res.text());
  const origin = new URL(url).origin;
  const byUrl = new Map<string, PageCandidate>();
  $("a[href]").each((_, el) => {
    try {
      const href = new URL($(el).attr("href")!, origin);
      href.hash = "";
      if (!isSameSite(href.origin, origin) || byUrl.size >= limit) return;
      const anchor = $(el).text().trim().slice(0, 120);
      const key = href.toString();
      const prev = byUrl.get(key);
      // Misma URL enlazada varias veces: conserva el ancla con texto (el logo del pie
      // suele enlazar sin texto y perderíamos la señal).
      if (!prev) byUrl.set(key, { url: key, anchor });
      else if (!prev.anchor && anchor) prev.anchor = anchor;
    } catch {}
  });
  return [...byUrl.values()];
}

/**
 * Lista final de páginas a indexar: sitemap ∪ enlaces del DOM, ordenada por relevancia y
 * recortada a `MAX_PAGES`. La URL de aterrizaje va siempre la primera.
 *
 * Best-effort en las dos fuentes: si ambas fallan queda `[landing]`, que es exactamente el
 * comportamiento de `crawl=false`.
 */
export async function discoverPages(landing: string, cap = MAX_PAGES): Promise<string[]> {
  let origin: string;
  try {
    origin = new URL(landing).origin;
  } catch {
    return [landing];
  }

  const [sitemapUrls, linked] = await Promise.all([
    fetchSitemapUrls(origin),
    discoverLinks(landing).catch(() => [] as PageCandidate[]),
  ]);

  // Los enlaces del DOM van primero en la lista de entrada: traen texto de ancla, que es
  // señal de ranking, y en los empates el orden de entrada es el desempate.
  const candidates: PageCandidate[] = [
    ...linked,
    ...sitemapUrls.map((u) => ({ url: u, anchor: "" })),
  ];

  return rankCandidateUrls(landing, candidates).slice(0, cap);
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
  // Descubrimiento en dos fuentes y ORDENADO POR RELEVANCIA antes de recortar:
  //  - sitemap.xml: listado completo publicado por la propia web (Shopify/Woo/Wix).
  //  - enlaces del DOM: respaldo y complemento, ahora TODOS (el pie incluido).
  // El orden importa más que el tope: con "los 8 primeros del DOM" las páginas de envíos
  // y devoluciones no se descargaban nunca, así que el RAG no podía responder a las dos
  // preguntas más frecuentes de una tienda por mucho que se afinara el retrieval.
  const urls = crawl ? await discoverPages(url) : [url];
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

  // `discoverPages` ya viene ordenada y recortada a MAX_PAGES; el slice se mantiene como
  // red de seguridad para el camino `crawl=false` y para llamadas directas.
  const attempted = urls.slice(0, MAX_PAGES);
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
