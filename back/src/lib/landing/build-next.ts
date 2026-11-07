/**
 * build-next.ts — the deterministic Next scaffold of the `next` build path (S7).
 *
 * The landing is generated as plain HTML. Asking the model for a Next project would mean
 * building and running model-authored code, so this path instead *wraps* the already-processed
 * delivery (images localized to `assets/*.webp`, third-party references stripped, Tailwind
 * compiled when needed) in a fixed scaffold. Every file below is produced by this module:
 *
 * - `package.json` / `next.config.mjs`: the pinned toolchain and a static export.
 * - `app/layout.tsx`: metadata from the HTML `<title>`/`<meta name="description">` and the AA
 *   webbot (`next/script`) when the delivery kept one.
 * - `app/globals.css`: the delivered `styles.css`, possibly empty.
 * - `app/page.tsx`: the delivered `<body>` rendered through `dangerouslySetInnerHTML`.
 * - `public/script.js` and `public/assets/*.webp`.
 *
 * The model markup only ever reaches the project as `JSON.stringify` strings, so `app/` never
 * executes anything it authored: no template literal, no interpolation, no raw `</script>`.
 * Asset references inside the body become `/assets/...` because `public/` is served at the root.
 *
 * Pure module: no I/O, no network, no clock. Same input → identical file map.
 */

import * as cheerio from "cheerio";

/**
 * The exact versions the scaffold and the Docker image share (`docker/landing-next/package.json`
 * pins the same ones; a test keeps them in sync). They follow `front/package.json` majors:
 * Next 15.5.x, React 19.x.
 */
export const NEXT_TOOLCHAIN = {
  next: "15.5.29",
  react: "19.2.7",
  reactDom: "19.2.7",
  typescript: "5.9.3",
  typesReact: "19.2.17",
  typesReactDom: "19.2.3",
  typesNode: "20.19.43",
} as const;

/** Ceilings for the metadata copied from model-generated HTML. */
const MAX_TITLE_CHARS = 300;
const MAX_DESCRIPTION_CHARS = 1000;
/** Only the asset names `build-images.ts` produces ever reach `public/assets/`. */
const SAFE_ASSET_PATH = /^assets\/[A-Za-z0-9_-]{1,80}\.webp$/;

/**
 * One `assets/<name>.webp` reference inside the body, with the character that introduces it.
 * Bounded (L8): a single character class for the name and no overlapping quantifier, so it
 * stays linear on hostile markup.
 */
const BODY_ASSET_REF_RE = /(^|["'(\s=,])(?:\.\/)?assets\/([A-Za-z0-9_-]{1,80}\.webp)/g;

export interface NextScaffoldInput {
  /** `index.html` after the T2/T3 pipeline (images localized, third parties stripped). */
  html: string;
  /** `styles.css` after the same pipeline (compiled Tailwind prepended), if any. */
  stylesCss?: string;
  /** `script.js` when it carries content, if any. */
  scriptJs?: string;
  /** Localized images: `assets/<hash>.webp` → bytes. */
  assets?: Record<string, Buffer>;
}

export interface AaWebbot {
  src: string;
  agentKey: string;
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
 *
 * It lives here, next to the layout that emits it, because both the S5 stripping in `build.ts`
 * and the scaffold must apply the same rule.
 */
export function isAaWebbot(src: string, agentKey: string | undefined): boolean {
  if (agentKey === undefined) return false;
  try {
    const url = new URL(src);
    return url.pathname === "/widget.js" && aaOrigins().has(url.origin);
  } catch {
    return false;
  }
}

/** The first AA webbot in the document's `<head>`, or null when the delivery kept none. */
function headWebbot($: cheerio.CheerioAPI): AaWebbot | null {
  for (const el of $("head script[src]").toArray()) {
    const node = $(el);
    const src = (node.attr("src") ?? "").trim();
    const agentKey = node.attr("data-agent-key");
    if (isAaWebbot(src, agentKey)) return { src, agentKey: String(agentKey) };
  }
  return null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * A JS/TS string literal for `value`, safe to embed in `app/*.tsx`.
 *
 * `JSON.stringify` covers quotes, backslashes and control characters, but leaves U+2028/U+2029
 * raw: ECMAScript 2019 allows them in a string literal, yet they are line terminators for other
 * parsers (and for anything that inlines the literal into HTML), so they are re-escaped here.
 * The value round-trips exactly: `JSON.parse` turns `\u2028` back into the separator.
 */
function asJsonLiteral(value: string): string {
  return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Body references to the localized images, rewritten to the root `public/` serves. */
function rewriteBodyAssets(body: string): string {
  return body.replace(BODY_ASSET_REF_RE, (_match, prefix: string, name: string) => `${prefix}/assets/${name}`);
}

function packageJsonFile(): string {
  const pkg = {
    name: "landing-next",
    version: "0.1.0",
    private: true,
    scripts: { build: "next build" },
    dependencies: {
      next: NEXT_TOOLCHAIN.next,
      react: NEXT_TOOLCHAIN.react,
      "react-dom": NEXT_TOOLCHAIN.reactDom,
    },
    devDependencies: {
      "@types/node": NEXT_TOOLCHAIN.typesNode,
      "@types/react": NEXT_TOOLCHAIN.typesReact,
      "@types/react-dom": NEXT_TOOLCHAIN.typesReactDom,
      typescript: NEXT_TOOLCHAIN.typescript,
    },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

const NEXT_CONFIG_FILE = `/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: false,
};

export default nextConfig;
`;

function layoutFile(title: string, description: string, webbot: AaWebbot | null): string {
  const imports = [
    'import type { Metadata } from "next";',
    'import type { ReactNode } from "react";',
  ];
  if (webbot) {
    imports.push('import Script from "next/script";');
    imports.push('import type { ComponentType } from "react";');
  }
  imports.push('import "./globals.css";');

  // `next/script` forwards unknown props to the rendered <script>, but its props type does not
  // declare `data-*` attributes; the cast keeps `next build`'s type check green.
  const webbotComponent = webbot
    ? `
const AaWebbot = Script as unknown as ComponentType<{
  src: string;
  "data-agent-key": string;
}>;
`
    : "";
  const webbotTag = webbot
    ? `        <AaWebbot src={${asJsonLiteral(webbot.src)}} data-agent-key={${asJsonLiteral(webbot.agentKey)}} />
`
    : "";

  return `${imports.join("\n")}
${webbotComponent}
export const metadata: Metadata = {
  title: ${asJsonLiteral(title)},
  description: ${asJsonLiteral(description)},
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
${webbotTag}      </body>
    </html>
  );
}
`;
}

function pageFile(body: string, hasScript: boolean): string {
  const scriptImport = hasScript ? 'import Script from "next/script";\n\n' : "";
  const scriptTag = hasScript ? `      <Script src="/script.js" />\n` : "";
  const content = hasScript
    ? `    <>
      <div dangerouslySetInnerHTML={{ __html: BODY }} />
${scriptTag}    </>`
    : `    <div dangerouslySetInnerHTML={{ __html: BODY }} />`;

  return `${scriptImport}// The delivered <body>, carried as data: model markup is never code.
const BODY = ${asJsonLiteral(body)};

export default function Page() {
  return (
${content}
  );
}
`;
}

/**
 * Builds the Next project of a landing (S7). Deterministic: the returned map depends only on
 * the input delivery, in the order of the keys below.
 */
export function buildNextScaffold(input: NextScaffoldInput): Record<string, Buffer | string> {
  const $ = cheerio.load(input.html);
  const title = truncate(($("title").first().text() ?? "").trim(), MAX_TITLE_CHARS);
  const description = truncate(
    ($('meta[name="description"]').first().attr("content") ?? "").trim(),
    MAX_DESCRIPTION_CHARS
  );
  const body = rewriteBodyAssets($("body").html() ?? "");
  const scriptJs = input.scriptJs !== undefined && input.scriptJs.trim().length > 0 ? input.scriptJs : undefined;

  const files: Record<string, Buffer | string> = {
    "package.json": packageJsonFile(),
    "next.config.mjs": NEXT_CONFIG_FILE,
    "app/layout.tsx": layoutFile(title, description, headWebbot($)),
    "app/globals.css": input.stylesCss ?? "",
    "app/page.tsx": pageFile(body, scriptJs !== undefined),
  };
  if (scriptJs !== undefined) files["public/script.js"] = scriptJs;

  // Sorted so the map (and the ZIP built from it) is stable across runs.
  const assets = Object.entries(input.assets ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [assetPath, buffer] of assets) {
    if (!SAFE_ASSET_PATH.test(assetPath)) continue; // only what build-images.ts produces
    files[`public/${assetPath}`] = buffer;
  }

  return files;
}
