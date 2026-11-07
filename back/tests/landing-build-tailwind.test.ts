/**
 * Landing build — the `tailwind` path (S6).
 *
 * The build compiles Tailwind in process (library `tailwindcss` 3.4 + `postcss`) with the
 * landing HTML and `script.js` as the only content, prepends the minified CSS to `styles.css`
 * and removes the CDN script plus the inline `tailwind.config` script (whose object is read with
 * a JSON5 parser, never executed). `mode` omitted → `tailwind` on a CDN landing, `static`
 * otherwise; explicit `static` on a CDN landing is 422 `TAILWIND_REQUIRES_COMPILE`.
 *
 * Hermetic: express local + `rawRequest` reading a Buffer, `@/lib/db`, `@/lib/openai`,
 * `@/lib/limiters` and `node:dns` stubbed, global `fetch` stubbed (no test downloads anything).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import JSZip from "jszip";
import postcss from "postcss";

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

const mockLookup = (dns as any).promises.lookup as ReturnType<typeof vi.fn>;
const findUnique = prisma.landingProject.findUnique as ReturnType<typeof vi.fn>;
const update = prisma.landingProject.update as ReturnType<typeof vi.fn>;

const CDN = '<script src="https://cdn.tailwindcss.com"></script>';

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
  path: string,
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
      const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
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

function jsonBody(res: { body: Buffer }): any {
  return JSON.parse(res.body.toString("utf8"));
}

async function buildZip(status: number, res: { body: Buffer }): Promise<JSZip> {
  expect(status).toBe(200);
  return JSZip.loadAsync(res.body);
}

async function zipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`missing entry ${path}`);
  return file.async("string");
}

/** Stylesheet links in the delivered HTML (must be exactly one when CSS is delivered). */
function stylesLinkCount(html: string): number {
  return (html.match(/<link[^>]+styles\.css[^>]*>/gi) ?? []).length;
}

function project(files: Record<string, string>, overrides: Record<string, unknown> = {}) {
  return { id: "abcdef1234567890", name: "Mi Landing", business: null, files, ...overrides };
}

async function postBuild(payload?: unknown) {
  return rawRequest(buildApp(), "POST", "/api/landing/abcdef1234567890/build", payload);
}

/** A landing that pulls Tailwind from the CDN and uses three utilities. */
function cdnLandingHtml(extraHead = "", body = ""): string {
  return `<!doctype html><html><head>${CDN}${extraHead}</head><body><div class="bg-red-500 p-4 md:flex">hola</div>${body}</body></html>`;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  update.mockResolvedValue({});
  fetchMock.mockRejectedValue(new Error("the tailwind path must not download anything"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── S6: compile in process ───────────────────────────────────────────────────

describe("tailwind mode (S6)", () => {
  it("compiles the utilities used by the landing into styles.css and drops the CDN", async () => {
    findUnique.mockResolvedValue(project({ "index.html": cdnLandingHtml() }));
    const res = await postBuild({ mode: "tailwind" });
    const zip = await buildZip(res.status, res);

    const css = await zipText(zip, "mi-landing/styles.css");
    // Compiled utilities: base/utility layers present, one rule per used class.
    expect(css).toMatch(/\.bg-red-500\s*\{[^}]*background-color/);
    expect(css).toMatch(/\.p-4\s*\{\s*padding:\s*1rem/);
    expect(css).toContain(".md\\:flex");
    // Minified: no indentation from the generated stylesheet, and still valid CSS.
    expect(css).not.toContain("\n  ");
    expect(() => postcss.parse(css)).not.toThrow();

    const html = await zipText(zip, "mi-landing/index.html");
    expect(html).not.toContain("cdn.tailwindcss.com");
    expect(stylesLinkCount(html)).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(res.headers["content-disposition"]).toBe('attachment; filename="mi-landing.zip"');
  });

  it("keeps the existing styles.css content after the compiled CSS", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": cdnLandingHtml('<link rel="stylesheet" href="styles.css">'),
        "styles.css": ".custom{color:green}",
      })
    );
    const res = await postBuild({ mode: "tailwind" });
    const zip = await buildZip(res.status, res);

    const css = await zipText(zip, "mi-landing/styles.css");
    expect(css).toContain(".custom{color:green}");
    expect(css.indexOf(".bg-red-500")).toBeLessThan(css.indexOf(".custom"));

    const html = await zipText(zip, "mi-landing/index.html");
    expect(stylesLinkCount(html)).toBe(1);
  });

  it("links styles.css exactly once when the landing already links it twice", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": cdnLandingHtml(
          '<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="./styles.css">'
        ),
      })
    );
    const res = await postBuild({ mode: "tailwind" });
    const zip = await buildZip(res.status, res);
    const html = await zipText(zip, "mi-landing/index.html");
    expect(stylesLinkCount(html)).toBe(1);
  });

  it("reads theme and darkMode from the inline config without executing it", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<!doctype html><html><head>${CDN}<script>tailwind.config = { theme: { extend: { colors: { brand: "#123456" } } }, darkMode: "class" };</script></head><body><div class="bg-brand dark:bg-brand">x</div></body></html>`,
      })
    );
    const res = await postBuild({ mode: "tailwind" });
    const zip = await buildZip(res.status, res);

    const css = await zipText(zip, "mi-landing/styles.css");
    // #123456 as tailwind serializes it (hex or its rgb triple) inside the .bg-brand rule.
    expect(css).toMatch(/\.bg-brand\s*\{[^}]*(#123456|18 52 86)/);
    // darkMode: "class" from the config → the dark variant is class-driven, not media.
    expect(css).toContain(".dark\\:bg-brand");
    expect(css).not.toContain("prefers-color-scheme");

    const html = await zipText(zip, "mi-landing/index.html");
    expect(html).not.toContain("tailwind.config");
    expect(html).not.toContain("cdn.tailwindcss.com");
  });

  it("ignores plugins, content, important and prefix from the inline config", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<!doctype html><html><head>${CDN}<script>
          tailwind.config = {
            content: ["./generated/**/*.html"],
            plugins: [],
            important: true,
            prefix: "x-",
            theme: { extend: { colors: { brand: "#123456" } } },
          };
        </script></head><body><div class="bg-red-500 bg-brand">x</div></body></html>`,
      })
    );
    const res = await postBuild({ mode: "tailwind" });
    const zip = await buildZip(res.status, res);

    const css = await zipText(zip, "mi-landing/styles.css");
    // The configured theme still applies…
    expect(css).toContain(".bg-brand");
    // …but `prefix` is dropped (no `x-` classes) and `important` never reaches the output.
    expect(css).not.toContain("x-bg-");
    expect(css).not.toContain("!important");
  });

  it("422 TAILWIND_CONFIG_UNSUPPORTED for a malformed inline config", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<!doctype html><html><head>${CDN}<script>tailwind.config = { theme: { extend: {</script></head><body><div class="bg-red-500">x</div></body></html>`,
      })
    );
    const res = await postBuild({ mode: "tailwind" });
    expect(res.status).toBe(422);
    expect(jsonBody(res).code).toBe("TAILWIND_CONFIG_UNSUPPORTED");
  });

  it("422 TAILWIND_CONFIG_UNSUPPORTED when the inline config holds a function", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<!doctype html><html><head>${CDN}<script>tailwind.config = { theme: { extend: { x: () => 1 } } };</script></head><body><div class="bg-red-500">x</div></body></html>`,
      })
    );
    const res = await postBuild({ mode: "tailwind" });
    expect(res.status).toBe(422);
    expect(jsonBody(res).code).toBe("TAILWIND_CONFIG_UNSUPPORTED");
  });

  it("422 TAILWIND_CONFIG_UNSUPPORTED when the CDN asks for plugins", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<!doctype html><html><head><script src="https://cdn.tailwindcss.com?plugins=forms,typography"></script></head><body><div class="bg-red-500">x</div></body></html>`,
      })
    );
    const res = await postBuild({ mode: "tailwind" });
    expect(res.status).toBe(422);
    expect(jsonBody(res).code).toBe("TAILWIND_CONFIG_UNSUPPORTED");
  });

  it("answers 422 in under 2 s for a hostile 200k-brace inline config", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<!doctype html><html><head>${CDN}<script>tailwind.config = {${"{".repeat(200_000)}</script></head><body><div class="x">x</div></body></html>`,
      })
    );
    const started = Date.now();
    const res = await postBuild({ mode: "tailwind" });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(res.status).toBe(422);
    expect(jsonBody(res).code).toBe("TAILWIND_CONFIG_UNSUPPORTED");
  });

  it("422 BUILD_INPUT_TOO_LARGE when HTML plus script.js exceed 1 MB", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<!doctype html><html><head>${CDN}</head><body>${"x".repeat(1_100_000)}</body></html>`,
      })
    );
    const res = await postBuild({});
    expect(res.status).toBe(422);
    expect(jsonBody(res).code).toBe("BUILD_INPUT_TOO_LARGE");
  });
});

// ── S6: mode resolution ──────────────────────────────────────────────────────

describe("mode resolution (S6)", () => {
  it("picks tailwind when mode is omitted on a CDN landing", async () => {
    findUnique.mockResolvedValue(project({ "index.html": cdnLandingHtml() }));
    const res = await postBuild({});
    const zip = await buildZip(res.status, res);

    const css = await zipText(zip, "mi-landing/styles.css");
    expect(css).toMatch(/\.p-4\s*\{\s*padding:\s*1rem/);
    const html = await zipText(zip, "mi-landing/index.html");
    expect(html).not.toContain("cdn.tailwindcss.com");
  });

  it("picks static when mode is omitted on a plain landing", async () => {
    findUnique.mockResolvedValue(
      project({ "index.html": '<html><body><div class="bg-red-500">x</div></body></html>' })
    );
    const res = await postBuild({});
    const zip = await buildZip(res.status, res);
    expect(zip.file("mi-landing/styles.css")).toBeFalsy();
    expect(await zipText(zip, "mi-landing/index.html")).toContain("bg-red-500");
  });

  it("422 TAILWIND_REQUIRES_COMPILE for an explicit static build of a CDN landing", async () => {
    findUnique.mockResolvedValue(project({ "index.html": cdnLandingHtml() }));
    const res = await postBuild({ mode: "static" });
    expect(res.status).toBe(422);
    expect(jsonBody(res).code).toBe("TAILWIND_REQUIRES_COMPILE");
  });

  it("keeps next at 501 BUILD_MODE_NOT_READY", async () => {
    findUnique.mockResolvedValue(project({ "index.html": cdnLandingHtml() }));
    const res = await postBuild({ mode: "next" });
    expect(res.status).toBe(501);
    expect(jsonBody(res).code).toBe("BUILD_MODE_NOT_READY");
  });
});
