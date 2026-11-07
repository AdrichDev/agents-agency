/**
 * build.ts — Landing delivery build (S2–S5).
 *
 * `buildLanding` turns a landing project into a self-contained set of entries (relative to the
 * landing root) and `zipLanding` wraps them in a ZIP under `<slug>/`. The pipeline is:
 *
 * 1. `filterSafeFiles` + drop dotfiles (never delivered).
 * 2. require `index.html` (else 422 `NOTHING_TO_BUILD`).
 * 3. resolve the build mode: `tailwind` when the HTML pulls the Tailwind CDN, else `static`.
 *    `next` answers 501 `BUILD_MODE_NOT_READY` until T4 plugs in; an explicit `static` on a
 *    Tailwind-CDN landing answers 422 `TAILWIND_REQUIRES_COMPILE`.
 * 4. in `tailwind` mode, compile `index.html` + `script.js` in process (S6, `build-tailwind.ts`)
 *    and prepend the CSS to `styles.css`; the CDN script and the inline config are removed.
 * 5. localize images (S4) and strip third-party scripts/stylesheets (S5).
 * 6. assemble the entries: `index.html` always, `styles.css`/`script.js` only when non-empty.
 *
 * Nothing is persisted: the caller streams the ZIP and the project row is never touched.
 */

import * as cheerio from "cheerio";
import JSZip from "jszip";
import { HttpError } from "@/lib/http";
import { filterSafeFiles, isDotfilePath } from "./paths";
import { parseFiles } from "./serialization";
import { buildImages, stripRemoteImports } from "./build-images";
import { prepareTailwind, usesTailwindCdn } from "./build-tailwind";

export type BuildMode = "static" | "tailwind" | "next";

/** Minimum project shape the build needs (the whole Prisma row also fits). */
export interface LandingBuildInput {
  id: string;
  name?: string | null;
  files?: unknown;
}

export interface LandingBuild {
  /** Landing root folder inside the ZIP. */
  slug: string;
  /** Path relative to `<slug>/` → text or binary content. */
  entries: Record<string, Buffer | string>;
}

const MAX_SLUG_LENGTH = 60;

/**
 * Kebab-case ASCII slug of a project name (max 60 chars), or `landing-<8 id chars>` when the
 * name has no usable characters. A landing always gets its own root folder (S3).
 */
export function slugForProject(project: LandingBuildInput): string {
  const slug = (project.name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || `landing-${project.id.slice(0, 8)}`;
}

/** True when the HTML pulls Tailwind from its CDN (re-exported for the build callers). */
export { usesTailwindCdn };

/** A reference to another origin: absolute or protocol-relative. */
function isRemoteRef(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("//");
}

/** Origins AA itself is served from (where `widget.js` lives). Read at call time. */
function aaOrigins(): Set<string> {
  const origins = new Set<string>([`http://localhost:${process.env.PORT || 4000}`]);
  for (const value of [process.env.PUBLIC_URL, process.env.BACK_URL, process.env.RENDER_EXTERNAL_URL]) {
    try {
      if (value) origins.add(new URL(value).origin);
    } catch {
      // Malformed env value: ignored.
    }
  }
  return origins;
}

/**
 * The AA webbot: `<script src="<AA origin>/widget.js" data-agent-key="...">`. The attribute
 * alone proves nothing (the HTML is model-generated), so the origin and path must match too.
 */
function isAaWebbot(src: string, agentKey: string | undefined): boolean {
  if (agentKey === undefined) return false;
  try {
    const url = new URL(src);
    return url.pathname === "/widget.js" && aaOrigins().has(url.origin);
  } catch {
    return false;
  }
}

/**
 * Strips a remote reference from one attribute: the element itself for a leaf/embedding tag,
 * only the attribute for `<video>`/`<audio>` (they can wrap local `<source>` fallbacks).
 */
function removeRemoteAttr(
  $: cheerio.CheerioAPI,
  selector: string,
  attr: string,
  removeElement: boolean
): void {
  $(selector).each((_, el) => {
    const node = $(el);
    if (!isRemoteRef((node.attr(attr) ?? "").trim())) return;
    if (removeElement) node.remove();
    else node.removeAttr(attr);
  });
}

/**
 * Removes third-party delivery references (S5): remote `<script src>`/`<link href>`, remote
 * frames/objects/embeds/media, `<meta http-equiv="refresh">` and remote `@import` rules. Only
 * AA's own webbot script is preserved; `<a href>` and local relative references are untouched.
 */
export function stripThirdParty(html: string): string {
  const $ = cheerio.load(html);
  $("script[src]").each((_, el) => {
    const node = $(el);
    const src = (node.attr("src") ?? "").trim();
    if (isAaWebbot(src, node.attr("data-agent-key"))) return;
    if (isRemoteRef(src)) node.remove();
  });
  $("link[href]").each((_, el) => {
    const node = $(el);
    if (isRemoteRef((node.attr("href") ?? "").trim())) node.remove();
  });

  // Embedded frames/objects and media fallbacks pointing at another origin.
  removeRemoteAttr($, "iframe[src]", "src", true);
  removeRemoteAttr($, "object[data]", "data", true);
  removeRemoteAttr($, "embed[src]", "src", true);
  removeRemoteAttr($, "track[src]", "src", true);
  removeRemoteAttr($, "source[src]", "src", true);
  removeRemoteAttr($, "video[src]", "src", false);
  removeRemoteAttr($, "audio[src]", "src", false);

  // <meta http-equiv="refresh"> (any case) would redirect the delivered page elsewhere.
  $("meta[http-equiv]").each((_, el) => {
    const node = $(el);
    if ((node.attr("http-equiv") ?? "").trim().toLowerCase() === "refresh") node.remove();
  });

  // Remote @import rules inside <style> blocks (`styles.css` is handled where it is serialized).
  $("style").each((_, el) => {
    const node = $(el);
    node.text(stripRemoteImports(node.text()));
  });

  return $.html();
}

/**
 * Builds the landing delivery. Throws `HttpError` for every contract violation; the route maps
 * it to the response. Does not write anything.
 */
export async function buildLanding(
  project: LandingBuildInput,
  options: { mode?: BuildMode } = {}
): Promise<LandingBuild> {
  const { files } = filterSafeFiles(parseFiles(project.files));
  const deliverable: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (!isDotfilePath(path)) deliverable[path] = content;
  }

  const indexHtml = deliverable["index.html"];
  if (indexHtml === undefined) {
    throw new HttpError(422, "No hay index.html que construir", "NOTHING_TO_BUILD");
  }

  // Mode resolution (S6) happens before any work so T4 only replaces the `next` branch.
  const hasTailwindCdn = usesTailwindCdn(indexHtml);
  const mode = options.mode ?? (hasTailwindCdn ? "tailwind" : "static");
  if (mode === "next") {
    throw new HttpError(501, "Modo de build aún no disponible", "BUILD_MODE_NOT_READY");
  }
  if (mode === "static" && hasTailwindCdn) {
    // Explicit `static` on a Tailwind-CDN landing cannot be delivered as-is.
    throw new HttpError(
      422,
      "La landing usa el CDN de Tailwind: usa el modo tailwind",
      "TAILWIND_REQUIRES_COMPILE"
    );
  }

  if (mode === "tailwind") {
    // Compiles in process and strips the CDN script + inline config (S6). The compiled CSS is
    // prepended to `styles.css`, so it goes through the image/webp and @import passes below.
    const compiled = await prepareTailwind(indexHtml, deliverable["script.js"] ?? "");
    const existingCss = deliverable["styles.css"];
    deliverable["index.html"] = compiled.html;
    deliverable["styles.css"] =
      existingCss && existingCss.trim().length > 0 ? `${compiled.css}\n${existingCss}` : compiled.css;
  }

  const images = await buildImages(deliverable);
  const html = stripThirdParty(images.html);
  const stylesCss =
    images.stylesCss === undefined ? undefined : stripRemoteImports(images.stylesCss);

  const entries: Record<string, Buffer | string> = {};
  for (const [path, content] of Object.entries(deliverable)) {
    if (images.consumed.has(path)) continue; // replaced by a webp asset
    if (path === "index.html" || path === "styles.css") continue; // handled below
    if (path === "script.js" && content.trim().length === 0) continue;
    entries[path] = content;
  }
  entries["index.html"] = html;
  if (stylesCss !== undefined && stylesCss.trim().length > 0) {
    entries["styles.css"] = stylesCss;
  }
  for (const [path, buffer] of Object.entries(images.assets)) entries[path] = buffer;

  return { slug: slugForProject(project), entries };
}

/** Wraps the built entries in a ZIP whose root is `<slug>/`. */
export async function zipLanding(build: LandingBuild): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(build.entries)) {
    zip.file(`${build.slug}/${path}`, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}
