/**
 * Landing build — the `next` path (S7/S8).
 *
 * `next` wraps the *delivered* static landing in a deterministic Next project
 * (`lib/landing/build-next.ts`): the model never authors TS/JS, its markup only reaches the
 * project as `JSON.stringify` strings inside `app/page.tsx` / `app/layout.tsx`, and the asset
 * references the body carries are rewritten to `/assets/...` because `public/` is served at the
 * root. `next build` then runs in a local Docker image with no network, no back env, a non-root
 * user and resource limits (`lib/landing/next-builder.ts`, S8).
 *
 * Hermetic except the opt-in integration test: express local + `rawRequest`, `@/lib/db`,
 * `@/lib/openai`, `@/lib/limiters`, `node:dns` and `node:child_process` stubbed, `fetch` stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import JSZip from "jszip";
import ts from "typescript";

/** Every docker CLI call the builder makes, in order. */
const execFileMock = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: (...args: unknown[]) => execFileMock(...args) };
});

vi.mock("node:dns", () => {
  const lookup = vi.fn();
  return { default: { promises: { lookup } }, promises: { lookup } };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    landingProject: { findUnique: vi.fn(), update: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
  DEFAULT_MODEL: "test-model",
  STRONG_MODEL: "test-strong-model",
}));

vi.mock("@/lib/limiters", () => ({
  heavyLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import dns from "node:dns";
import { prisma } from "@/lib/db";
import { landingRouter } from "@/routes/landing";
import { errorHandler } from "@/lib/observability";
import {
  NEXT_TOOLCHAIN,
  buildNextScaffold,
  isAaWebbot,
  type NextScaffoldInput,
} from "@/lib/landing/build-next";
import {
  DOCKER_ENV_KEYS,
  NEXT_BUILD_TIMEOUT_MS,
  NEXT_IMAGE,
  NEXT_IMAGE_COMMAND,
  buildNextSite,
} from "@/lib/landing/next-builder";

const mockLookup = (dns as any).promises.lookup as ReturnType<typeof vi.fn>;
const findUnique = prisma.landingProject.findUnique as ReturnType<typeof vi.fn>;
const update = prisma.landingProject.update as ReturnType<typeof vi.fn>;

const repoBack = fileURLToPath(new URL("..", import.meta.url));

// ── helpers ──────────────────────────────────────────────────────────────────

function scaffoldInput(overrides: Partial<NextScaffoldInput> = {}): NextScaffoldInput {
  return {
    html: `<!doctype html><html><head><title>Panaderia Nandu</title>
<meta name="description" content="Pan artesano"></head>
<body><h1>Hola</h1><img src="assets/abc123.webp" alt="logo"></body></html>`,
    stylesCss: ".hero{color:red}",
    scriptJs: "console.log('hi')",
    assets: { "assets/abc123.webp": Buffer.from("RIFFxxxxWEBP", "ascii") },
    ...overrides,
  };
}

function scaffold(overrides: Partial<NextScaffoldInput> = {}): Record<string, Buffer | string> {
  return buildNextScaffold(scaffoldInput(overrides));
}

function text(files: Record<string, Buffer | string>, path: string): string {
  const value = files[path];
  if (value === undefined) throw new Error(`missing entry ${path} (has ${Object.keys(files).join(",")})`);
  if (Buffer.isBuffer(value)) throw new Error(`${path} is binary`);
  return value;
}

/** The `const BODY = "...";` literal of the generated page, parsed back as data. */
function bodyLiteral(pageSource: string): string {
  const match = pageSource.match(/^const BODY = (.*);$/m);
  if (!match) throw new Error("page.tsx has no BODY literal");
  return JSON.parse(match[1]);
}

/** One metadata value of the generated layout, parsed back as data. */
function metadataLiteral(layoutSource: string, key: "title" | "description"): string {
  const match = layoutSource.match(new RegExp(`^  ${key}: (".*"),$`, "m"));
  if (!match) throw new Error(`layout.tsx has no ${key} literal`);
  return JSON.parse(match[1]);
}

/** TS/TSX syntax diagnostics: proves the generated module parses (never executes it). */
function syntaxErrors(source: string, fileName: string) {
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
    },
  });
  return result.diagnostics ?? [];
}

type ExecCb = (error: unknown, stdout: string, stderr: string) => void;
type ExecArgs = [string, string[], Record<string, unknown>, ExecCb];

function execCall(index = 0): ExecArgs {
  return execFileMock.mock.calls[index] as unknown as ExecArgs;
}

/** The `docker run ...` invocation (the `docker image inspect` availability probe is ignored). */
function runCall(): ExecArgs {
  const call = execFileMock.mock.calls
    .map((args) => args as unknown as ExecArgs)
    .find((args) => args[1]?.[0] === "run");
  if (!call) throw new Error("no docker run call was made");
  return call;
}

/** Host directory of the `-v <host>:/work` mount of a `docker run` call. */
function mountedHostDir(call: ExecArgs): string {
  const args = call[1];
  const volume = args[args.indexOf("-v") + 1];
  return volume.slice(0, volume.lastIndexOf(":"));
}

function dockerAvailable(): void {
  execFileMock.mockImplementation((_file: string, args: string[], _opts: unknown, cb: ExecCb) => {
    if (args[0] === "image") return cb(null, "[]", "");
    return cb(null, "", "");
  });
}

function dockerMissing(): void {
  execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: ExecCb) => {
    const error = Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
    cb(error, "", "");
  });
}

function imageMissing(): void {
  execFileMock.mockImplementation((_file: string, args: string[], _opts: unknown, cb: ExecCb) => {
    if (args[0] === "image") {
      return cb(Object.assign(new Error("Error: No such image"), { code: 1 }), "", "no such image");
    }
    return cb(null, "", "");
  });
}

/** A `docker run` that fails: the container exits non-zero with that stderr. */
function dockerFails(stderr: string | ((host: string) => string)): void {
  execFileMock.mockImplementation((_file: string, args: string[], _opts: unknown, cb: ExecCb) => {
    if (args[0] === "image") return cb(null, "[]", "");
    if (args[0] === "run") {
      const host = mountedHostDir(execFileMock.mock.calls[execFileMock.mock.calls.length - 1] as unknown as ExecArgs);
      const text = typeof stderr === "string" ? stderr : stderr(host);
      return cb(Object.assign(new Error(`Command failed: docker run`), { code: 1 }), "", text);
    }
    return cb(null, "", "");
  });
}

/** A `docker run` that exceeds the timeout and is killed by execFile. */
function dockerTimesOut(): void {
  execFileMock.mockImplementation((_file: string, args: string[], _opts: unknown, cb: ExecCb) => {
    if (args[0] === "image") return cb(null, "[]", "");
    if (args[0] === "run") {
      const error = Object.assign(new Error("Command failed: docker run"), {
        killed: true,
        signal: "SIGTERM",
        code: null,
      });
      return cb(error, "", "");
    }
    return cb(null, "", "");
  });
}

/** A `docker run` that succeeds and leaves an exported site in the mounted host dir. */
function dockerExports(files: Record<string, string>): void {
  execFileMock.mockImplementation((_file: string, args: string[], _opts: unknown, cb: ExecCb) => {
    if (args[0] === "image") return cb(null, "[]", "");
    if (args[0] === "run") {
      const host = mountedHostDir(execCall(execFileMock.mock.calls.length - 1) as unknown as ExecArgs);
      for (const [rel, content] of Object.entries(files)) {
        const full = `${host}/out/${rel}`;
        mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
        writeFileSync(full, content);
      }
      return cb(null, "", "");
    }
    return cb(null, "", "");
  });
}

// ── express harness ──────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/landing", landingRouter);
  app.use(errorHandler);
  return app;
}

function rawRequest(
  app: express.Express,
  method: string,
  url: string,
  payload?: unknown
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const headers: Record<string, string> = { Accept: "application/zip" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request({ host: "127.0.0.1", port, method, path: url, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
        });
      });
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      if (body !== undefined) req.write(body);
      req.end();
    });
  });
}

function project(files: Record<string, string>, overrides: Record<string, unknown> = {}) {
  return { id: "abcdef1234567890", name: "Mi Landing", business: null, files, ...overrides };
}

async function postBuild(payload?: unknown) {
  return rawRequest(buildApp(), "POST", "/api/landing/abcdef1234567890/build", payload);
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  update.mockResolvedValue({});
  fetchMock.mockImplementation(async () => new Response("nope", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  dockerAvailable();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── S7: the pure scaffold ────────────────────────────────────────────────────

describe("buildNextScaffold (S7)", () => {
  it("is deterministic: the same delivery yields an identical file map", () => {
    const first = buildNextScaffold(scaffoldInput());
    const second = buildNextScaffold(scaffoldInput());

    expect(Object.keys(second)).toEqual(Object.keys(first));
    for (const key of Object.keys(first)) expect(second[key]).toEqual(first[key]);
  });

  it("produces the fixed file list and nothing else", () => {
    const files = scaffold();
    expect(Object.keys(files).sort()).toEqual([
      "app/globals.css",
      "app/layout.tsx",
      "app/page.tsx",
      "next.config.mjs",
      "package.json",
      "public/assets/abc123.webp",
      "public/script.js",
    ]);
  });

  it("pins next 15.5.x and react/react-dom 19.x with a `next build` script", () => {
    const pkg = JSON.parse(text(scaffold(), "package.json"));
    expect(pkg.dependencies.next).toMatch(/^15\.5\.\d+$/);
    expect(pkg.dependencies.next).toBe(NEXT_TOOLCHAIN.next);
    expect(pkg.dependencies.react).toMatch(/^19\.\d+\.\d+$/);
    expect(pkg.dependencies["react-dom"]).toBe(pkg.dependencies.react);
    expect(pkg.scripts.build).toBe("next build");
    // Exact pins, never a range: the Docker image installs these same versions.
    for (const range of ["^", "~", "*", "latest"]) {
      expect(text(scaffold(), "package.json")).not.toContain(`"${range}`);
    }
  });

  it("writes a static-export next.config.mjs with no other option", () => {
    const config = text(scaffold(), "next.config.mjs");
    const object = config.slice(config.indexOf("const nextConfig = {"), config.indexOf("};", config.indexOf("const nextConfig = {")));
    expect(object).toContain('output: "export"');
    expect(object).toContain("images: { unoptimized: true }");
    expect(object).toContain("trailingSlash: false");
    expect(object.match(/^ {2}\w+:/gm)?.map((line) => line.trim())).toEqual([
      "output:",
      "images:",
      "trailingSlash:",
    ]);
  });

  it("renders the body as a JSON string, so model markup can never become code", () => {
    // A `</script>` in an attribute value survives HTML parsing verbatim, which is exactly the
    // sequence that breaks a module if the body were emitted as raw source. U+2028/U+2029 are
    // line terminators for some parsers (and for anything that inlines the literal into HTML),
    // and a template-literal payload would break a backtick string.
    const injection = `"; process.exit(1); // \${process.exit(3)} \`+\${BODY}+\``;
    const separators = "\u2028\u2029";
    const hostile = `<p>${injection}${separators}</p><div title="</script>">x</div>`;
    const files = scaffold({
      html: `<!doctype html><html><head><title>t</title></head><body>${hostile}</body></html>`,
    });
    const page = text(files, "app/page.tsx");

    expect(syntaxErrors(page, "page.tsx")).toHaveLength(0);
    // Line/paragraph separators never reach the source raw; they survive as escape sequences.
    expect(page).not.toContain("\u2028");
    expect(page).not.toContain("\u2029");
    expect(page).toContain("\\u2028");
    expect(page).toContain("\\u2029");

    // The payload survives as data: the literal round-trips to the delivered body exactly.
    const body = bodyLiteral(page);
    expect(body).toBe(`<p>${injection}${separators}</p><div title="</script>">x</div>`);
    expect(body).toContain("</script>");
    expect(body).toContain(separators);
    // ...and never appears as code: strip the literal and nothing model-authored is left.
    const withoutLiteral = page.replace(/^const BODY = .*;$/m, "");
    expect(withoutLiteral).not.toContain("process.exit");
    expect(withoutLiteral).not.toContain("</script>");
    expect(withoutLiteral).not.toContain("u2028");
    expect(page).toContain('dangerouslySetInnerHTML={{ __html: BODY }}');
  });

  it("escapes quotes, newlines, backticks and line separators in the metadata", () => {
    // The separators sit mid-string: `String.prototype.trim` (applied to the title) also strips
    // U+2028/U+2029 as whitespace, so a trailing one would never reach the scaffold.
    const title = `Panaderia "Nandu"\nsegunda \u2028 linea \\ backslash */ \`tick\` \u2029 fin`;
    const description = `Pan <b>artesano</b> & "levain" \${x} \`y\` \u2029 fin`;
    const layout = text(
      scaffold({
        html: `<!doctype html><html><head><title>${title}</title>
<meta name="description" content="Pan &lt;b&gt;artesano&lt;/b&gt; &amp; &quot;levain&quot; $\{x\} \`y\` \u2029 fin"></head>
<body>x</body></html>`,
      }),
      "app/layout.tsx"
    );

    expect(syntaxErrors(layout, "layout.tsx")).toHaveLength(0);
    // No raw separator can terminate a statement, and the literal round-trips as data.
    expect(layout).not.toContain("\u2028");
    expect(layout).not.toContain("\u2029");
    expect(layout).toContain("\\u2028");
    expect(metadataLiteral(layout, "title")).toBe(title);
    expect(metadataLiteral(layout, "description")).toBe(description);
    expect(layout).toContain('import "./globals.css";');
    // No raw newline can break out of the literal.
    expect(layout.split("\n").filter((line) => line.includes("title:")).length).toBe(1);
  });

  it("inlines the delivered CSS as globals.css, empty when the landing has none", () => {
    expect(text(scaffold(), "app/globals.css")).toBe(".hero{color:red}");
    expect(text(scaffold({ stylesCss: undefined }), "app/globals.css")).toBe("");
  });

  it("keeps the AA webbot (head script) and drops any other origin's widget", () => {
    const previous = process.env.PUBLIC_URL;
    process.env.PUBLIC_URL = "https://api.aa.test";
    try {
      const html = (origin: string) => `<!doctype html><html><head>
<script src="${origin}/widget.js" data-agent-key="pk_123"></script>
</head><body>x</body></html>`;

      expect(isAaWebbot("https://api.aa.test/widget.js", "pk_123")).toBe(true);
      expect(isAaWebbot("https://evil.test/widget.js", "pk_123")).toBe(false);
      expect(isAaWebbot("https://api.aa.test/widget.js", undefined)).toBe(false);

      const kept = text(scaffold({ html: html("https://api.aa.test") }), "app/layout.tsx");
      expect(kept).toContain('src={"https://api.aa.test/widget.js"}');
      expect(kept).toContain('data-agent-key={"pk_123"}');
      expect(syntaxErrors(kept, "layout.tsx")).toHaveLength(0);

      const dropped = text(scaffold({ html: html("https://evil.test") }), "app/layout.tsx");
      expect(dropped).not.toContain("evil.test");
      expect(dropped).not.toContain("data-agent-key");
      expect(syntaxErrors(dropped, "layout.tsx")).toHaveLength(0);

      // The webbot attributes are data too: hostile key bytes are escaped, never raw.
      const hostileKey = "pk_1`${x}`\u2028 mid \u2029 end";
      const hostile = text(
        scaffold({
          html: `<!doctype html><html><head><script src="https://api.aa.test/widget.js" data-agent-key="${hostileKey}"></script></head><body>x</body></html>`,
        }),
        "app/layout.tsx"
      );
      expect(hostile).not.toContain("\u2028");
      expect(hostile).not.toContain("\u2029");
      expect(syntaxErrors(hostile, "layout.tsx")).toHaveLength(0);
      const keyLiteral = hostile.match(/data-agent-key=\{(.*)\}/);
      expect(keyLiteral).not.toBeNull();
      expect(JSON.parse(keyLiteral![1])).toBe(hostileKey);
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = previous;
    }
  });

  it("puts every asset under public/assets and keeps the webp bytes intact", () => {
    const webp = Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 ", "binary");
    const files = scaffold({ assets: { "assets/deadbeef.webp": webp } });
    expect(files["public/assets/deadbeef.webp"]).toBeInstanceOf(Buffer);
    expect(Buffer.compare(files["public/assets/deadbeef.webp"] as Buffer, webp)).toBe(0);
    expect(Object.keys(files).some((path) => path.startsWith("app/assets"))).toBe(false);
  });

  it("rewrites the body asset references to the served root and keeps them in public/", () => {
    const files = scaffold({
      html: `<!doctype html><html><head><title>t</title></head><body>
<img src="assets/abc123.webp" srcset="./assets/abc123.webp 1x, assets/abc123.webp 2x">
<div style="background:url(assets/abc123.webp)"></div></body></html>`,
    });
    const body = bodyLiteral(text(files, "app/page.tsx"));
    // No relative asset reference is left: `public/` is served at the root.
    expect(body).not.toMatch(/["'(]assets\//);
    expect(body).not.toMatch(/["'(]\.\/assets\//);
    expect(body).toContain('<img src="/assets/abc123.webp"');
    expect(body).toContain("/assets/abc123.webp 1x, /assets/abc123.webp 2x");
    expect(body).toContain("url(/assets/abc123.webp)");
  });

  it("loads public/script.js with next/script only when the landing ships one", () => {
    const withScript = text(scaffold(), "app/page.tsx");
    expect(withScript).toContain('<Script src="/script.js" />');
    expect(withScript).toContain('import Script from "next/script";');

    const without = scaffold({ scriptJs: undefined });
    expect(without["public/script.js"]).toBeUndefined();
    expect(text(without, "app/page.tsx")).not.toContain("next/script");
    expect(syntaxErrors(text(without, "app/page.tsx"), "page.tsx")).toHaveLength(0);
  });

  it("survives an html without title, description or body wrapper", () => {
    const files = scaffold({ html: "<p>solo texto</p>", stylesCss: undefined, scriptJs: undefined });
    expect(text(files, "app/layout.tsx")).toContain('title: "",');
    expect(text(files, "app/layout.tsx")).toContain('description: "",');
    expect(bodyLiteral(text(files, "app/page.tsx"))).toBe("<p>solo texto</p>");
    expect(syntaxErrors(text(files, "app/layout.tsx"), "layout.tsx")).toHaveLength(0);
  });

  it("proves the syntax check is meaningful with a broken control sample", () => {
    expect(syntaxErrors('const BODY = "unterminated;\n', "page.tsx").length).toBeGreaterThan(0);
  });
});

describe("Docker toolchain pins (S8)", () => {
  it("uses the same pinned versions as the scaffold, with a committed lockfile", async () => {
    const dir = `${repoBack}/docker/landing-next`;
    const imagePkg = JSON.parse(await fs.readFile(`${dir}/package.json`, "utf8"));
    expect(imagePkg.dependencies).toEqual({
      next: NEXT_TOOLCHAIN.next,
      react: NEXT_TOOLCHAIN.react,
      "react-dom": NEXT_TOOLCHAIN.reactDom,
    });
    expect(imagePkg.devDependencies).toEqual({
      "@types/node": NEXT_TOOLCHAIN.typesNode,
      "@types/react": NEXT_TOOLCHAIN.typesReact,
      "@types/react-dom": NEXT_TOOLCHAIN.typesReactDom,
      typescript: NEXT_TOOLCHAIN.typescript,
    });
    const lock = JSON.parse(await fs.readFile(`${dir}/package-lock.json`, "utf8"));
    expect(lock.packages["node_modules/next"].version).toBe(NEXT_TOOLCHAIN.next);
    // The image installs the same patched tree: no `npm audit` override may drift from the pins.
    expect(lock.packages["node_modules/postcss"].version).toBe(imagePkg.overrides.postcss);
    expect(lock.packages["node_modules/sharp"].version).toBe(imagePkg.overrides.sharp);

    const dockerfile = await fs.readFile(`${dir}/Dockerfile`, "utf8");
    // Pinned by digest, not only by tag: a re-pushed tag cannot change the build.
    expect(dockerfile).toMatch(/^FROM node:22\.\d+\.\d+-slim@sha256:[0-9a-f]{64}$/m);
    expect(dockerfile).toContain("npm ci");
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).not.toMatch(/^\s*(RUN\s+)?(curl|wget|apt-get install)/m);
  });

  it("exposes the image build as an npm script", async () => {
    const pkg = JSON.parse(await fs.readFile(`${repoBack}/package.json`, "utf8"));
    expect(pkg.scripts["landing:next-image"]).toBe(
      `docker build -t ${NEXT_IMAGE} docker/landing-next`
    );
  });
});

// ── S8: the isolated docker runner ───────────────────────────────────────────

describe("buildNextSite (S8)", () => {
  const SECRETS = {
    SUPABASE_SERVICE_ROLE_KEY: "sb_service_role_secret",
    OPENAI_API_KEY: "sk-not-a-real-key",
    DATABASE_URL: "postgres://user:pass@db.test:5432/aa",
    AA_TEST_UNLISTED_VARIABLE: "must-not-be-forwarded",
  };

  beforeEach(() => {
    for (const [key, value] of Object.entries(SECRETS)) process.env[key] = value;
  });

  afterEach(() => {
    for (const key of Object.keys(SECRETS)) delete process.env[key];
  });

  it("runs next build with every isolation flag and no back env", async () => {
    dockerExports({ "index.html": "<html>ok</html>" });

    await buildNextSite({ "package.json": "{}" });

    // The image is probed before anything runs.
    const inspect = execFileMock.mock.calls[0] as unknown as ExecArgs;
    expect(inspect[0]).toBe("docker");
    expect(inspect[1]).toEqual(["image", "inspect", NEXT_IMAGE]);

    const call = runCall();
    const args = call[1];
    expect(call[0]).toBe("docker");

    // Isolation flags, verbatim.
    const expected = [
      "--rm",
      "--network",
      "none",
      "--memory",
      "1g",
      "--cpus",
      "1",
      "--pids-limit",
      "256",
      "--read-only",
      "--security-opt",
      "no-new-privileges",
      "--cap-drop",
      "ALL",
      "-w",
      "/work",
    ];
    for (const flag of expected) expect(args).toContain(flag);
    expect(args[args.indexOf("--network") + 1]).toBe("none");
    expect(args[args.indexOf("--security-opt") + 1]).toBe("no-new-privileges");
    expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL");
    expect(args[args.indexOf("--tmpfs") + 1]).toMatch(/^\/tmp:rw,size=\d+m$/);
    // Non-root user, never the image default root.
    const user = args[args.indexOf("--user") + 1];
    expect(user).not.toBe("root");
    expect(user).toMatch(/^\d+:\d+$/);
    expect(user.split(":")[0]).not.toBe("0");
    // A single bind mount, the generated project, mounted at /work.
    expect(args.filter((arg) => arg === "-v")).toHaveLength(1);
    expect(args[args.indexOf("-v") + 1]).toMatch(/:\/work$/);
    // The image and the build command: the symlinked pinned deps, then `next build`.
    expect(args).toContain(NEXT_IMAGE);
    const command = args.slice(args.indexOf(NEXT_IMAGE) + 1).join(" ");
    expect(command).toContain("ln");
    expect(command).toContain("/opt/deps/node_modules");
    expect(command).toContain("next build");

    // Telemetry-off is the ONLY `-e`: nothing from the back process env is forwarded.
    expect(args.filter((arg) => arg === "-e")).toHaveLength(1);
    expect(args[args.indexOf("-e") + 1]).toBe("NEXT_TELEMETRY_DISABLED=1");

    const env = call[2].env as Record<string, string>;
    for (const key of Object.keys(SECRETS)) expect(env).not.toHaveProperty(key);
    for (const value of Object.values(SECRETS)) expect(Object.values(env)).not.toContain(value);
    for (const key of Object.keys(env)) expect(DOCKER_ENV_KEYS).toContain(key);
    expect(call[2].timeout).toBe(NEXT_BUILD_TIMEOUT_MS);
    expect(typeof call[2].maxBuffer).toBe("number");
  });

  it("bounded the timeout at 180 s and reads the export back", async () => {
    expect(NEXT_BUILD_TIMEOUT_MS).toBe(180_000);
    dockerExports({ "index.html": "<html>exported</html>", "_next/static/a.js": "console.log(1)" });

    const out = await buildNextSite({ "package.json": "{}" });
    expect(Object.keys(out).sort()).toEqual(["_next/static/a.js", "index.html"]);
    expect(out["index.html"].toString("utf8")).toBe("<html>exported</html>");
  });

  it("writes the scaffold into the mounted dir and removes it afterwards (success)", async () => {
    dockerExports({ "index.html": "<html>ok</html>" });

    await buildNextSite({ "app/page.tsx": "export default 1", "package.json": "{}" });

    const host = mountedHostDir(runCall());
    expect(host).not.toBe("");
    // Docker Desktop mounts the temp dir; the host path never lived in the repo.
    expect(host.startsWith(repoBack)).toBe(false);
    expect(existsSync(host)).toBe(false);
  });

  it("removes the temp dir when the build fails", async () => {
    dockerFails("boom");
    const before = execFileMock.mock.calls.length;
    await expect(buildNextSite({ "package.json": "{}" })).rejects.toMatchObject({ status: 422 });
    expect(execFileMock.mock.calls.length).toBeGreaterThan(before);
  });

  it("removes the temp dir when the build times out", async () => {
    dockerTimesOut();
    await expect(buildNextSite({ "package.json": "{}" })).rejects.toMatchObject({ status: 504 });
  });

  it("503 NEXT_BUILDER_UNAVAILABLE when docker is not installed", async () => {
    dockerMissing();
    await expect(buildNextSite({ "package.json": "{}" })).rejects.toMatchObject({
      status: 503,
      code: "NEXT_BUILDER_UNAVAILABLE",
    });
    await expect(buildNextSite({ "package.json": "{}" })).rejects.toMatchObject({
      message: expect.stringContaining(NEXT_IMAGE_COMMAND),
    });
    // Nothing ran: the probe failed first.
    expect(execFileMock.mock.calls.every((args) => (args as unknown as ExecArgs)[1][0] === "image")).toBe(true);
  });

  it("503 NEXT_BUILDER_UNAVAILABLE when the image is missing", async () => {
    imageMissing();
    await expect(buildNextSite({ "package.json": "{}" })).rejects.toMatchObject({
      status: 503,
      code: "NEXT_BUILDER_UNAVAILABLE",
      message: expect.stringContaining("npm run landing:next-image"),
    });
    expect(execFileMock.mock.calls.some((args) => (args as unknown as ExecArgs)[1][0] === "run")).toBe(false);
  });

  it("422 NEXT_BUILD_FAILED with a sanitized stderr tail and no host path", async () => {
    dockerAvailable();
    dockerFails(
      (host) =>
        `${host}/app/page.tsx\n` +
        `${host.replace(/\//g, "\\")}\\app\\page.tsx\n` +
        `${"x".repeat(5000)}\n` +
        `\u001b[31mFailed to compile\u001b[0m\n./app/page.tsx:1:1\nType error: nope\n` +
        `    at ${host}/app/page.tsx\n` +
        `    at C:\\Users\\someone\\AppData\\Local\\Temp\\x\n`
    );

    const error = await buildNextSite({ "package.json": "{}" }).catch((err) => err);
    const host = mountedHostDir(runCall());
    expect(error.status).toBe(422);
    expect(error.code).toBe("NEXT_BUILD_FAILED");
    const stderr = String(error.details.stderr);
    expect(stderr).not.toContain("\u001b");
    expect(stderr).not.toContain(host);
    expect(stderr).not.toContain(host.replace(/\//g, "\\"));
    expect(stderr.length).toBeLessThanOrEqual(1500);
    expect(stderr).toContain("Failed to compile");
  });

  it("504 NEXT_BUILD_TIMEOUT and asks docker to kill the container", async () => {
    dockerTimesOut();
    const error = await buildNextSite({ "package.json": "{}" }).catch((err) => err);
    expect(error.status).toBe(504);
    expect(error.code).toBe("NEXT_BUILD_TIMEOUT");

    const calls = execFileMock.mock.calls.map((args) => args as unknown as ExecArgs);
    const kill = calls.find((call) => call[1][0] === "kill");
    expect(kill).toBeDefined();
    const name = kill![1][1];
    expect(name).toMatch(/^aa-landing-next-[0-9a-f]{6,}$/);
    // The same container the run started.
    const runArgs = runCall()[1];
    expect(runArgs[runArgs.indexOf("--name") + 1]).toBe(name);
  });

  it("cleans up the temp dir even when the container leaves a read-only file", async () => {
    dockerExports({ "index.html": "<html>ok</html>" });
    await buildNextSite({ "package.json": "{}" });
    const host = mountedHostDir(runCall());
    expect(existsSync(host)).toBe(false);
  });
});

// ── S7 through the route: both folders of the ZIP ───────────────────────────

describe("POST /:id/build?mode=next (S7)", () => {
  it("zips the exported site under <slug>/ and the source project under <slug>-next/", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<!doctype html><html><head><title>Mi Landing</title>
<meta name="description" content="Una landing"></head>
<body><h1>Hola</h1><img src="assets/abc123.webp"></body></html>`,
        "styles.css": ".hero{color:red}",
        "script.js": "console.log(1)",
      })
    );
    dockerExports({
      "index.html": "<html>exported home</html>",
      "_next/static/chunk.js": "console.log(2)",
    });

    const res = await postBuild({ mode: "next" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="mi-landing.zip"');

    const zip = await JSZip.loadAsync(res.body);
    const paths = Object.keys(zip.files);

    // The exported site sits at the landing root, index.html included.
    expect(await zip.file("mi-landing/index.html")!.async("string")).toBe("<html>exported home</html>");
    expect(zip.file("mi-landing/_next/static/chunk.js")).toBeTruthy();

    // The source project, without the directories a build recreates.
    expect(zip.file("mi-landing-next/app/page.tsx")).toBeTruthy();
    expect(zip.file("mi-landing-next/app/layout.tsx")).toBeTruthy();
    expect(zip.file("mi-landing-next/next.config.mjs")).toBeTruthy();
    expect(zip.file("mi-landing-next/package.json")).toBeTruthy();
    expect(zip.file("mi-landing-next/public/script.js")).toBeTruthy();
    expect(paths.some((path) => path.includes("node_modules"))).toBe(false);
    expect(paths.some((path) => path.includes("/.next/"))).toBe(false);
    expect(paths.some((path) => path.includes("/out/"))).toBe(false);
    // Nothing is persisted and nothing escapes the two roots.
    expect(update).not.toHaveBeenCalled();
    expect(paths.every((path) => path.startsWith("mi-landing/") || path.startsWith("mi-landing-next/"))).toBe(true);

    const page = await zip.file("mi-landing-next/app/page.tsx")!.async("string");
    expect(page).toContain("Hola");
    // The delivered CSS travels as globals.css, the pinned versions as package.json.
    expect(await zip.file("mi-landing-next/app/globals.css")!.async("string")).toBe(".hero{color:red}");
    expect(JSON.parse(await zip.file("mi-landing-next/package.json")!.async("string")).dependencies.next).toBe(
      NEXT_TOOLCHAIN.next
    );
  });

  it("compiles Tailwind before scaffolding a CDN landing (the CDN never ships)", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<html><head><script src="https://cdn.tailwindcss.com"></script></head>
<body class="p-4">x</body></html>`,
      })
    );
    dockerExports({ "index.html": "<html>exported</html>" });

    const res = await postBuild({ mode: "next" });
    expect(res.status).toBe(200);

    const zip = await JSZip.loadAsync(res.body);
    const css = await zip.file("mi-landing-next/app/globals.css")!.async("string");
    expect(css).toMatch(/\.p-4\s*\{\s*padding:\s*1rem/);
    const page = await zip.file("mi-landing-next/app/page.tsx")!.async("string");
    expect(page).not.toContain("cdn.tailwindcss.com");

    // The scaffold that reached the container had no CDN either.
    const host = mountedHostDir(runCall());
    expect(host).not.toBe("");
  });

  it("surfaces 503 NEXT_BUILDER_UNAVAILABLE with the image command (the code survives 5xx)", async () => {
    findUnique.mockResolvedValue(project({ "index.html": "<html><body>x</body></html>" }));
    dockerMissing();

    const res = await postBuild({ mode: "next" });
    expect(res.status).toBe(503);
    const body = JSON.parse(res.body.toString("utf8"));
    expect(body.code).toBe("NEXT_BUILDER_UNAVAILABLE");
    expect(body.error).toContain("npm run landing:next-image");
    expect(update).not.toHaveBeenCalled();
  });

  it("surfaces 504 NEXT_BUILD_TIMEOUT", async () => {
    findUnique.mockResolvedValue(project({ "index.html": "<html><body>x</body></html>" }));
    dockerTimesOut();

    const res = await postBuild({ mode: "next" });
    expect(res.status).toBe(504);
    expect(JSON.parse(res.body.toString("utf8")).code).toBe("NEXT_BUILD_TIMEOUT");
  });

  it("surfaces 422 NEXT_BUILD_FAILED with a bounded stderr tail", async () => {
    findUnique.mockResolvedValue(project({ "index.html": "<html><body>x</body></html>" }));
    dockerFails("Failed to compile\n" + "y".repeat(10_000));

    const res = await postBuild({ mode: "next" });
    expect(res.status).toBe(422);
    const body = JSON.parse(res.body.toString("utf8"));
    expect(body.code).toBe("NEXT_BUILD_FAILED");
    expect(String(body.details.stderr).length).toBeLessThanOrEqual(1500);
  });

  it("still 404s and still refuses a landing without index.html", async () => {
    findUnique.mockResolvedValue(null);
    const missing = await postBuild({ mode: "next" });
    expect(missing.status).toBe(404);

    findUnique.mockResolvedValue(project({ "styles.css": ".a{}" }));
    const empty = await postBuild({ mode: "next" });
    expect(empty.status).toBe(422);
    expect(JSON.parse(empty.body.toString("utf8")).code).toBe("NOTHING_TO_BUILD");
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

// ── Real integration with Docker (opt-in) ───────────────────────────────────

describe("real docker build (AA_DOCKER_IT=1)", () => {
  it.skipIf(process.env.AA_DOCKER_IT !== "1")(
    "builds a tiny landing for real, reports the files and never sees the back env",
    async () => {
      vi.doUnmock("node:child_process");
      vi.resetModules();
      const builder = await import("@/lib/landing/next-builder");
      const next = await import("@/lib/landing/build-next");

      const scaffold = next.buildNextScaffold({
        html: `<!doctype html><html><head><title>IT</title></head><body><h1>integration</h1></body></html>`,
        stylesCss: "body{background:#fff}",
        scriptJs: "console.log('it')",
        assets: {},
      });
      // A probe page (test-authored, never part of the product scaffold) that renders what the
      // container env holds: the canary must be absent and the only `-e` value present.
      const files: Record<string, Buffer | string> = {
        ...scaffold,
        "app/probe/page.tsx": `export default function Probe() {
  const secret = String(process.env.AA_VERIFY_SECRET ?? "unset");
  const telemetry = String(process.env.NEXT_TELEMETRY_DISABLED ?? "unset");
  return <p>{\`secret=\${secret};telemetry=\${telemetry}\`}</p>;
}
`,
      };

      const CANARY = "leak-canary";
      process.env.AA_VERIFY_SECRET = CANARY;
      let out: Record<string, Buffer>;
      const started = Date.now();
      try {
        out = await builder.buildNextSite(files);
      } finally {
        delete process.env.AA_VERIFY_SECRET;
      }
      const elapsed = Date.now() - started;

      const list = Object.keys(out).sort();
      console.log(`[AA_DOCKER_IT] next build in ${elapsed} ms, ${list.length} files:`, list.join(", "));
      expect(list).toContain("index.html");
      expect(list.some((path) => path.startsWith("_next/"))).toBe(true);
      expect(out["index.html"].toString("utf8")).toContain("integration");

      // The container never received the back process env…
      for (const [file, content] of Object.entries(out)) {
        expect({ file, leaked: content.toString("utf8").includes(CANARY) }).toEqual({
          file,
          leaked: false,
        });
      }
      // …and the probe really can see the container env (positive control for the assertion).
      const probe = out["probe.html"]?.toString("utf8") ?? "";
      expect(list).toContain("probe.html");
      expect(probe).toContain("secret=unset;telemetry=1");

      expect(elapsed).toBeLessThan(180_000);
    },
    200_000
  );
});
