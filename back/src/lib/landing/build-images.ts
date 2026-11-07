/**
 * build-images.ts — Localize the images of a landing build (S4).
 *
 * Every remote image referenced by `index.html` (`<img src>`, `srcset`, `<source srcset>`,
 * `url()` in `style`/`<style>`/`styles.css`) is downloaded through the SSRF guard, re-encoded
 * to webp (auto-rotate, max 1600px, quality 80) and stored at `assets/<sha1-12>.webp`; every
 * reference is rewritten to that path. Local raster images in the map (`assets/x.png|jpg|gif`,
 * stored as a data URL or base64) go through the same pipeline. `data:` URIs are left as they
 * are; remote `.svg` is rasterized like any other image, while a local `.svg` in the map is
 * delivered untouched. Decoding is capped at 50 MP so a small file cannot declare a
 * decompression bomb. Nothing is persisted: this module only transforms strings.
 *
 * Any download or conversion failure is a 422 `IMAGE_UNAVAILABLE` carrying the offending URL,
 * so the whole build fails rather than shipping a broken reference.
 */

import crypto from "crypto";
import * as cheerio from "cheerio";
import sharp from "sharp";
import { HttpError } from "@/lib/http";
import { safeFetch } from "@/lib/ssrf";

export const MAX_BUILD_IMAGES = 30;
/** Decode ceiling: a tiny file can otherwise declare billions of pixels (decompression bomb). */
export const MAX_INPUT_PIXELS = 50_000_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 15_000;

/** CSS `url(...)` with an optional single/double quote (or none) around the value. */
// One bounded class only: the former `url\(\s*(".."|'..'|[^)'"]*)\s*\)` backtracked
// cubically on `url(` + spaces (20k spaces > 60 s). Quotes are handled by `parseUrlArg`.
const URL_FUNCTION_RE = /url\(([^)]{0,2048})\)/gi;

/** The argument of a CSS `url(...)`: its value and the quote it used (if any). */
function parseUrlArg(arg: string): { value: string; quote: string } {
  const trimmed = arg.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.length >= 2 && trimmed.endsWith(quote)) {
    return { value: trimmed.slice(1, -1).trim(), quote };
  }
  return { value: trimmed, quote: "" };
}
const REMOTE_RE = /^https?:\/\//i;
const RASTER_RE = /\.(png|jpe?g|gif)$/i;

/**
 * One whole `@import` rule, capturing its target (url() or bare string). Imports pull
 * stylesheets, never images, so they must not reach the image collector.
 */
// Linear on hostile CSS: no overlapping quantifiers and every run is bounded. The previous
// `url\(\s*(...|[^)'"]*)\s*\)` backtracked for minutes on `@import url(` + 200k spaces.
const IMPORT_RE = /@import\s{0,64}(?:url\(([^)]{0,2048})\)|"([^"]{0,2048})"|'([^']{0,2048})')[^;]{0,2048};?/gi;

/** Target of an `@import`: the url() argument without quotes, or the bare string. */
function importTarget(inUrl?: string, dq?: string, sq?: string): string {
  const raw = (inUrl ?? dq ?? sq ?? "").trim();
  return raw.replace(/^(["'])(.*)\1$/, "$2").trim();
}

/** A reference to another origin: absolute or protocol-relative. */
function isRemoteRef(value: string): boolean {
  return REMOTE_RE.test(value) || value.startsWith("//");
}

/** CSS with every `@import` rule blanked out (used only for image detection). */
function withoutImports(css: string): string {
  return css.replace(IMPORT_RE, " ");
}

/** CSS with only the remote `@import` rules removed; local relative ones stay (S5). */
export function stripRemoteImports(css: string): string {
  return css.replace(IMPORT_RE, (match, inUrl, dq, sq) =>
    isRemoteRef(importTarget(inUrl, dq, sq)) ? "" : match
  );
}

export interface BuiltImages {
  /** `index.html` with all rewritten references. */
  html: string;
  /** `styles.css` with all rewritten references, or undefined when there was no stylesheet. */
  stylesCss: string | undefined;
  /** New asset path (`assets/<hash>.webp`) → webp bytes. */
  assets: Record<string, Buffer>;
  /** Local map keys replaced by a webp asset (they must not be copied verbatim). */
  consumed: Set<string>;
}

/** One `url(...)` value per match, ignoring the quoting style. */
function cssUrls(css: string): string[] {
  const out: string[] = [];
  for (const match of css.matchAll(URL_FUNCTION_RE)) {
    const { value } = parseUrlArg(match[1] ?? "");
    if (value) out.push(value);
  }
  return out;
}

/** Candidate URLs from a `srcset` (first whitespace-delimited token of each candidate). */
function srcsetCandidates(srcset: string): string[] {
  return srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/** Every image reference carried by `index.html` and, when present, `styles.css`. */
export function collectImageRefs(html: string, stylesCss?: string): Set<string> {
  const $ = cheerio.load(html);
  const refs = new Set<string>();
  const add = (value?: string | null) => {
    const trimmed = value?.trim();
    if (trimmed) refs.add(trimmed);
  };

  $("img[src]").each((_, el) => add($(el).attr("src")));
  $("img[srcset], source[srcset]").each((_, el) => {
    for (const candidate of srcsetCandidates($(el).attr("srcset") ?? "")) add(candidate);
  });
  $("[style]").each((_, el) => {
    for (const url of cssUrls(withoutImports($(el).attr("style") ?? ""))) add(url);
  });
  $("style").each((_, el) => {
    for (const url of cssUrls(withoutImports($(el).text()))) add(url);
  });
  for (const url of cssUrls(withoutImports(stylesCss ?? ""))) add(url);

  return refs;
}

/** Map key of a referenced local raster, or undefined when the reference is not one. */
function localRasterKey(deliverable: Record<string, string>, ref: string): string | undefined {
  const clean = ref.split(/[?#]/)[0].replace(/^\.\//, "");
  if (!RASTER_RE.test(clean)) return undefined;
  return Object.prototype.hasOwnProperty.call(deliverable, clean) ? clean : undefined;
}

/** Local image stored as a data URL or raw base64 string → bytes. */
function decodeLocalImage(value: string): Buffer {
  const match = value.match(/^data:[^;,]*;base64,(.*)$/s);
  const base64 = (match ? match[1] : value).replace(/\s+/g, "");
  return Buffer.from(base64, "base64");
}

async function downloadImage(url: string): Promise<Buffer> {
  try {
    const res = await safeFetch(url, {
      maxBytes: MAX_IMAGE_BYTES,
      timeoutMs: IMAGE_TIMEOUT_MS,
      allowRedirects: true,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch {
    throw new HttpError(422, "No se pudo descargar la imagen", "IMAGE_UNAVAILABLE", { url });
  }
}

async function toWebp(raw: Buffer, url: string): Promise<Buffer> {
  try {
    return await sharp(raw, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new HttpError(422, "No se pudo convertir la imagen a webp", "IMAGE_UNAVAILABLE", { url });
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces every CSS `url(...)` whose value is a known reference. */
function rewriteCssUrls(css: string, rewrite: (value: string) => string): string {
  return css.replace(URL_FUNCTION_RE, (match, arg: string) => {
    const { value, quote } = parseUrlArg(arg);
    const next = rewrite(value);
    if (next === value) return match;
    return `url(${quote}${next}${quote})`;
  });
}

function rewriteSrcset(srcset: string, rewrite: (value: string) => string): string {
  return srcset
    .split(",")
    .map((candidate) => {
      const match = candidate.trim().match(/^(\S+)([\s\S]*)$/);
      if (!match) return candidate;
      return rewrite(match[1]) + match[2];
    })
    .join(", ");
}

/** Rewrites every image reference in the HTML DOM (attributes, srcset, style, <style>). */
function rewriteHtmlRefs(html: string, resolutions: Map<string, string>): string {
  if (resolutions.size === 0) return html;
  const $ = cheerio.load(html);
  const rewrite = (value: string) => resolutions.get(value.trim()) ?? value;

  $("img[src]").each((_, el) => {
    const node = $(el);
    const value = node.attr("src");
    if (value !== undefined) node.attr("src", rewrite(value));
  });
  $("img[srcset], source[srcset]").each((_, el) => {
    const node = $(el);
    const value = node.attr("srcset");
    if (value !== undefined) node.attr("srcset", rewriteSrcset(value, rewrite));
  });
  $("[style]").each((_, el) => {
    const node = $(el);
    const value = node.attr("style");
    if (value !== undefined) node.attr("style", rewriteCssUrls(value, rewrite));
  });
  $("style").each((_, el) => {
    const node = $(el);
    node.text(rewriteCssUrls(node.text(), rewrite));
  });

  return $.html();
}

/**
 * Materializes every image of a deliverable into webp assets and returns the rewritten HTML
 * and stylesheet. Throws `HttpError` 422 `IMAGE_UNAVAILABLE` on any download/conversion
 * failure or when the landing references more than `MAX_BUILD_IMAGES` images.
 */
export async function buildImages(deliverable: Record<string, string>): Promise<BuiltImages> {
  const html = deliverable["index.html"] ?? "";
  const stylesCss = deliverable["styles.css"];

  const refs = collectImageRefs(html, stylesCss);
  const sources = new Set<string>();
  // original reference (may carry `./` or a query) -> source key actually processed.
  const aliases = new Map<string, string>();
  for (const ref of refs) {
    if (REMOTE_RE.test(ref)) {
      // Remote images (including .svg, which sharp rasterizes) are downloaded and re-encoded.
      sources.add(ref);
      aliases.set(ref, ref);
    } else if (!/^data:/i.test(ref)) {
      const local = localRasterKey(deliverable, ref);
      if (local) {
        sources.add(local);
        aliases.set(ref, local);
      }
    }
  }
  // Local rasters are converted even when nothing references them.
  for (const key of Object.keys(deliverable)) {
    if (RASTER_RE.test(key)) sources.add(key);
  }

  if (sources.size > MAX_BUILD_IMAGES) {
    throw new HttpError(
      422,
      `La landing referencia ${sources.size} imágenes; el máximo es ${MAX_BUILD_IMAGES}`,
      "IMAGE_UNAVAILABLE",
      { max: MAX_BUILD_IMAGES, count: sources.size }
    );
  }

  const assets: Record<string, Buffer> = {};
  const nameBySource = new Map<string, string>();
  const consumed = new Set<string>();

  for (const source of sources) {
    let raw: Buffer;
    if (REMOTE_RE.test(source)) {
      raw = await downloadImage(source);
    } else {
      raw = decodeLocalImage(deliverable[source] ?? "");
      consumed.add(source);
    }
    const webp = await toWebp(raw, source);
    const name = `assets/${crypto.createHash("sha1").update(webp).digest("hex").slice(0, 12)}.webp`;
    assets[name] = webp;
    nameBySource.set(source, name);
  }

  const resolutions = new Map<string, string>();
  for (const [ref, source] of aliases) {
    const name = nameBySource.get(source);
    if (name) resolutions.set(ref, name);
  }

  // Longest key first so a URL that is a prefix of another is never replaced partially.
  const ordered = new Map(
    [...resolutions.entries()].sort((a, b) => b[0].length - a[0].length)
  );
  const keys = [...ordered.keys()].map(escapeRegExp);
  const combined = keys.length ? new RegExp(keys.join("|"), "g") : null;
  const rewriteStyles = (css: string) =>
    combined ? css.replace(combined, (match) => ordered.get(match) ?? match) : css;

  return {
    html: rewriteHtmlRefs(html, resolutions),
    stylesCss: stylesCss === undefined ? undefined : rewriteStyles(stylesCss),
    assets,
    consumed,
  };
}
