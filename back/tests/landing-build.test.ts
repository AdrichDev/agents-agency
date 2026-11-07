/**
 * Landing build endpoint (`POST /api/landing/:id/build`, S2–S5).
 *
 * The `tailwind` compile path (S6) has its own suite: `landing-build-tailwind.test.ts`.
 *
 * The delivered ZIP is a self-contained project under `<slug>/`: remote images are pulled
 * through the SSRF guard and re-encoded to webp, third-party scripts/stylesheets are stripped
 * (the AA webbot is kept), and the server persists nothing.
 *
 * Hermetic: express local + `rawRequest` reading a Buffer, `@/lib/db`, `@/lib/openai`,
 * `@/lib/limiters`, `node:dns` and the global `fetch` stubbed. The real SSRF guard runs.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import JSZip from "jszip";
import sharp from "sharp";

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

// The real limiters skip themselves under Vitest; the spy proves the build goes through the
// heavy (cost) limiter.
const heavyLimiterSpy = vi.fn((_req: unknown, _res: unknown, next: () => void) => next());
vi.mock("@/lib/limiters", () => ({
  heavyLimiter: (req: unknown, res: unknown, next: () => void) => heavyLimiterSpy(req, res, next),
}));

import dns from "node:dns";
import { prisma } from "@/lib/db";
import { landingRouter } from "@/routes/landing";
import { errorHandler } from "@/lib/observability";

const mockLookup = (dns as any).promises.lookup as ReturnType<typeof vi.fn>;
const findUnique = prisma.landingProject.findUnique as ReturnType<typeof vi.fn>;
const update = prisma.landingProject.update as ReturnType<typeof vi.fn>;

let TINY_PNG: Buffer;
let TINY_DATA_URL: string;
/** 8000×8000 = 64 MP, over the 50 MP decode limit, but only ~200 KB compressed. */
let BOMB_PNG: Buffer;

beforeAll(async () => {
  TINY_PNG = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#f00" } })
    .png()
    .toBuffer();
  TINY_DATA_URL = `data:image/png;base64,${TINY_PNG.toString("base64")}`;
  BOMB_PNG = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: "#f00" } })
    .png({ compressionLevel: 9 })
    .toBuffer();
});

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

/** The webp assets stored under `<slug>/assets/` (files, not folder entries). */
function assetPaths(zip: JSZip, slug: string): string[] {
  const prefix = `${slug}/assets/`;
  return Object.keys(zip.files).filter((p) => p.startsWith(prefix) && !zip.files[p].dir);
}

const fetchMock = vi.fn();

/** A distinct tiny PNG per call so content-addressed webp names do not collapse together. */
async function pngVariant(seed: number): Promise<Buffer> {
  return sharp({ create: { width: 4 + seed, height: 4, channels: 3, background: "#f00" } })
    .png()
    .toBuffer();
}

function project(files: Record<string, string>, overrides: Record<string, unknown> = {}) {
  return { id: "abcdef1234567890", name: "Mi Landing", business: null, files, ...overrides };
}

async function postBuild(payload?: unknown) {
  return rawRequest(buildApp(), "POST", "/api/landing/abcdef1234567890/build", payload);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  update.mockResolvedValue({});
  let seed = 0;
  fetchMock.mockImplementation(async () => new Response(await pngVariant(seed++), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── S2: endpoint contract ────────────────────────────────────────────────────

describe("POST /:id/build (S2)", () => {
  it("returns an application/zip attachment named after the slug", async () => {
    findUnique.mockResolvedValue(project({ "index.html": "<html><body>hola</body></html>" }));
    const res = await postBuild({});

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="mi-landing.zip"');
    expect(update).not.toHaveBeenCalled();
  });

  it("404s for an unknown project", async () => {
    findUnique.mockResolvedValue(null);
    const res = await postBuild({});
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("422 NOTHING_TO_BUILD when there is no index.html after filtering", async () => {
    findUnique.mockResolvedValue(project({ "styles.css": ".a{}" }));
    const res = await postBuild({});
    expect(res.status).toBe(422);
    expect(jsonBody(res).code).toBe("NOTHING_TO_BUILD");
  });

  it("wires the build behind the heavy limiter", async () => {
    findUnique.mockResolvedValue(project({ "index.html": "<html></html>" }));
    await postBuild({});
    expect(heavyLimiterSpy).toHaveBeenCalledTimes(1);
  });

  it("501 BUILD_MODE_NOT_READY for the next mode", async () => {
    findUnique.mockResolvedValue(project({ "index.html": "<html><body>x</body></html>" }));
    const res = await postBuild({ mode: "next" });
    expect(res.status).toBe(501);
    expect(jsonBody(res).code).toBe("BUILD_MODE_NOT_READY");
    expect(update).not.toHaveBeenCalled();
  });

  it("422 TAILWIND_REQUIRES_COMPILE for an explicit static build of a Tailwind-CDN landing", async () => {
    findUnique.mockResolvedValue(
      project({ "index.html": '<html><head><script src="https://cdn.tailwindcss.com"></script></head><body>x</body></html>' })
    );
    const res = await postBuild({ mode: "static" });
    expect(res.status).toBe(422);
    expect(jsonBody(res).code).toBe("TAILWIND_REQUIRES_COMPILE");
  });

  it("builds Tailwind when the mode is omitted on a Tailwind-CDN landing", async () => {
    findUnique.mockResolvedValue(
      project({ "index.html": '<html><head><script src="https://cdn.tailwindcss.com"></script></head><body class="p-4">x</body></html>' })
    );
    const res = await postBuild({});
    const zip = await buildZip(res.status, res);
    expect(await zipText(zip, "mi-landing/styles.css")).toMatch(/\.p-4\s*\{\s*padding:\s*1rem/);
    expect(await zipText(zip, "mi-landing/index.html")).not.toContain("cdn.tailwindcss.com");
  });
});

// ── S3: delivery contract (slug + layout) ────────────────────────────────────

describe("delivery contract (S3)", () => {
  it("puts everything under <slug>/ and derives the slug from the name", async () => {
    findUnique.mockResolvedValue(
      project(
        { "index.html": "<html><body>x</body></html>", "styles.css": ".a{color:red}" },
        { name: "Panadería Ñandú!!" }
      )
    );
    const res = await postBuild({ mode: "static" });
    const zip = await buildZip(res.status, res);

    expect(zip.file("panaderia-nandu/index.html")).toBeTruthy();
    expect(zip.file("panaderia-nandu/styles.css")).toBeTruthy();
    // Nothing lives outside the landing root.
    expect(Object.keys(zip.files).every((p) => p.startsWith("panaderia-nandu/"))).toBe(true);
  });

  it("falls back to landing-<8 id chars> when the name has no usable characters", async () => {
    findUnique.mockResolvedValue(project({ "index.html": "<html></html>" }, { name: "✨✨" }));
    const res = await postBuild({ mode: "static" });
    const zip = await buildZip(res.status, res);
    expect(zip.file("landing-abcdef12/index.html")).toBeTruthy();
  });

  it("omits empty styles.css and script.js but keeps them when they carry content", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": "<html></html>",
        "styles.css": "   \n ",
        "script.js": "",
      })
    );
    const emptyRes = await postBuild({ mode: "static" });
    let zip = await buildZip(emptyRes.status, emptyRes);
    expect(zip.file("mi-landing/styles.css")).toBeFalsy();
    expect(zip.file("mi-landing/script.js")).toBeFalsy();

    findUnique.mockResolvedValue(
      project({ "index.html": "<html></html>", "styles.css": ".a{}", "script.js": "console.log(1)" })
    );
    const res = await postBuild({ mode: "static" });
    zip = await buildZip(res.status, res);
    expect(zip.file("mi-landing/styles.css")).toBeTruthy();
    expect(zip.file("mi-landing/script.js")).toBeTruthy();
  });

  it("never ships dotfiles or unsafe paths", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": "<html></html>",
        ".env": "SECRET=1",
        "../x": "nope",
        "assets/.hidden.png": TINY_DATA_URL,
      })
    );
    const res = await postBuild({ mode: "static" });
    const zip = await buildZip(res.status, res);
    const paths = Object.keys(zip.files);
    expect(paths.some((p) => p.includes(".env") || p.includes(".."))).toBe(false);
    expect(paths.some((p) => p.includes("SECRET"))).toBe(false);
  });
});

// ── S4: images to local webp ─────────────────────────────────────────────────

describe("images (S4)", () => {
  it("downloads remote images, rewrites every reference and stores webp assets", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<!doctype html><html><head>
<link rel="stylesheet" href="styles.css">
<style>.hero{background:url("https://img.test/bg.png")}</style>
</head><body>
<img src="https://img.test/a.png" alt="a">
<img srcset="https://img.test/a.png 1x, https://img.test/b.png 2x">
<picture><source srcset="https://img.test/c.png"></picture>
<div style="background-image:url(https://img.test/d.png)"></div>
</body></html>`,
        "styles.css": `.s{background:url('https://img.test/e.png')}`,
      })
    );
    const res = await postBuild({ mode: "static" });
    const zip = await buildZip(res.status, res);

    const html = await zipText(zip, "mi-landing/index.html");
    const css = await zipText(zip, "mi-landing/styles.css");

    // Six distinct URLs (a.png is referenced twice but fetched once).
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(html).not.toContain("img.test");
    expect(css).not.toContain("img.test");
    expect(html).toContain(".webp");
    expect(css).toContain(".webp");

    const assets = assetPaths(zip, "mi-landing");
    expect(assets).toHaveLength(6);
    for (const path of assets) {
      expect(path).toMatch(/^mi-landing\/assets\/[0-9a-f]{12}\.webp$/);
      const buf = await zip.file(path)!.async("nodebuffer");
      expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(buf.subarray(8, 12).toString("ascii")).toBe("WEBP");
    }
  });

  it("downloads a duplicated URL only once", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": '<html><body><img src="https://img.test/same.png"><img src="https://img.test/same.png"></body></html>',
      })
    );
    const res = await postBuild({ mode: "static" });
    const zip = await buildZip(res.status, res);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assetPaths(zip, "mi-landing")).toHaveLength(1);
  });

  it("converts local raster images stored as data URLs and rewrites their references", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": '<html><body><img src="assets/logo.png"></body></html>',
        "assets/logo.png": TINY_DATA_URL,
      })
    );
    const res = await postBuild({ mode: "static" });
    const zip = await buildZip(res.status, res);

    expect(assetPaths(zip, "mi-landing")).toHaveLength(1);
    expect(zip.file("mi-landing/assets/logo.png")).toBeFalsy();
    const html = await zipText(zip, "mi-landing/index.html");
    expect(html).not.toContain("assets/logo.png");
    expect(html).toMatch(/assets\/[0-9a-f]{12}\.webp/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rewrites a local raster referenced with a ./ prefix", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": '<html><body><img src="./assets/logo.png"></body></html>',
        "assets/logo.png": TINY_DATA_URL,
      })
    );
    const res = await postBuild({ mode: "static" });
    const zip = await buildZip(res.status, res);
    const html = await zipText(zip, "mi-landing/index.html");
    expect(html).not.toContain("./assets/logo.png");
    expect(html).toMatch(/assets\/[0-9a-f]{12}\.webp/);
  });

  it("rejects a loopback image URL with 422 IMAGE_UNAVAILABLE and never fetches", async () => {
    findUnique.mockResolvedValue(
      project({ "index.html": '<html><body><img src="http://127.0.0.1:8080/a.png"></body></html>' })
    );
    const res = await postBuild({ mode: "static" });
    expect(res.status).toBe(422);
    expect(jsonBody(res).code).toBe("IMAGE_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("422 IMAGE_UNAVAILABLE when a remote image cannot be downloaded", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));
    findUnique.mockResolvedValue(
      project({ "index.html": '<html><body><img src="https://img.test/missing.png"></body></html>' })
    );
    const res = await postBuild({ mode: "static" });
    expect(res.status).toBe(422);
    const body = jsonBody(res);
    expect(body.code).toBe("IMAGE_UNAVAILABLE");
    expect(body.details?.url).toBe("https://img.test/missing.png");
  });

  it("422 IMAGE_UNAVAILABLE for an undecodable local raster without fetching", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": '<html><body><img src="assets/bad.png"></body></html>',
        "assets/bad.png": "!!!not-an-image!!!",
      })
    );
    const res = await postBuild({ mode: "static" });
    expect(res.status).toBe(422);
    expect(jsonBody(res).code).toBe("IMAGE_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("422 IMAGE_UNAVAILABLE when there are more than 30 images", async () => {
    const imgs = Array.from({ length: 31 }, (_, i) => `<img src="https://img.test/${i}.png">`).join("");
    findUnique.mockResolvedValue(project({ "index.html": `<html><body>${imgs}</body></html>` }));
    const res = await postBuild({ mode: "static" });
    expect(res.status).toBe(422);
    expect(jsonBody(res).code).toBe("IMAGE_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("422 IMAGE_UNAVAILABLE for a >50 MP pixel bomb before decoding it", async () => {
    fetchMock.mockResolvedValue(new Response(BOMB_PNG, { status: 200 }));
    findUnique.mockResolvedValue(
      project({ "index.html": '<html><body><img src="https://img.test/bomb.png"></body></html>' })
    );
    const res = await postBuild({ mode: "static" });
    expect(res.status).toBe(422);
    expect(jsonBody(res).code).toBe("IMAGE_UNAVAILABLE");
  });

  it("still converts a 4x4 image (under the pixel limit)", async () => {
    fetchMock.mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
    findUnique.mockResolvedValue(
      project({ "index.html": '<html><body><img src="https://img.test/small.png"></body></html>' })
    );
    const res = await postBuild({ mode: "static" });
    const zip = await buildZip(res.status, res);
    const assets = assetPaths(zip, "mi-landing");
    expect(assets).toHaveLength(1);
    const buf = await zip.file(assets[0])!.async("nodebuffer");
    expect(buf.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("downloads and rasterizes a remote .svg to webp", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>';
    fetchMock.mockResolvedValue(new Response(svg, { status: 200 }));
    findUnique.mockResolvedValue(
      project({ "index.html": '<html><body><img src="https://img.test/icon.svg"></body></html>' })
    );
    const res = await postBuild({ mode: "static" });
    const zip = await buildZip(res.status, res);

    const assets = assetPaths(zip, "mi-landing");
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatch(/^mi-landing\/assets\/[0-9a-f]{12}\.webp$/);
    const buf = await zip.file(assets[0])!.async("nodebuffer");
    expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(buf.subarray(8, 12).toString("ascii")).toBe("WEBP");

    const html = await zipText(zip, "mi-landing/index.html");
    expect(html).not.toContain("icon.svg");
    expect(html).toMatch(/assets\/[0-9a-f]{12}\.webp/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves a local .svg in the map untouched", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>';
    findUnique.mockResolvedValue(
      project({
        "index.html": '<html><body><img src="assets/icon.svg"></body></html>',
        "assets/icon.svg": svg,
      })
    );
    const res = await postBuild({ mode: "static" });
    const zip = await buildZip(res.status, res);

    expect(assetPaths(zip, "mi-landing")).toEqual(["mi-landing/assets/icon.svg"]);
    expect(await zipText(zip, "mi-landing/assets/icon.svg")).toBe(svg);
    expect(await zipText(zip, "mi-landing/index.html")).toContain("assets/icon.svg");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── S5: no third-party CDNs in the delivery ──────────────────────────────────

describe("third-party stripping (S5)", () => {
  it("removes remote scripts/stylesheets, keeps the webbot, local links and <a href>", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<link rel="preconnect" href="https://fonts.gstatic.com">
<link rel="stylesheet" href="styles.css">
<script src="https://cdn.other.test/app.js"></script>
<script src="script.js"></script>
<script src="https://api.test/widget.js" data-agent-key="pk_123"></script>
<script src="https://evil.test/x.js" data-agent-key="pk_fake"></script>
<script src="https://evil.test/widget.js" data-agent-key="pk_fake2"></script>
</head><body>
<a href="https://other.test/pagina">Externo</a>
</body></html>`,
        "styles.css": ".a{color:red}",
        "script.js": "console.log(1)",
      })
    );
    // The webbot is kept only when it is AA's own widget.js; the attribute alone proves nothing.
    process.env.PUBLIC_URL = "https://api.test";
    const res = await postBuild({ mode: "static" });
    delete process.env.PUBLIC_URL;
    const zip = await buildZip(res.status, res);
    const html = await zipText(zip, "mi-landing/index.html");

    expect(html).not.toContain("evil.test");
    expect(html).not.toContain("pk_fake");
    expect(html).not.toContain("cdn.other.test");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
    expect(html).toContain('data-agent-key="pk_123"');
    expect(html).toContain("api.test/widget.js");
    expect(html).toContain("script.js");
    expect(html).toContain("styles.css");
    expect(html).toContain("https://other.test/pagina");
  });

  it("removes remote frames, embeds, media and meta refresh, keeps local ones", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<html><head>
<meta http-equiv="refresh" content="0;url=https://evil.test/">
<META HTTP-EQUIV="Refresh" content="5">
</head><body>
<iframe src="https://evil.test/frame"></iframe>
<iframe src="local-frame.html"></iframe>
<object data="https://evil.test/x.swf"></object>
<object data="local.swf"></object>
<embed src="https://evil.test/y.swf">
<embed src="local.swf">
<video src="https://evil.test/v.mp4"></video>
<audio src="https://evil.test/a.mp3"></audio>
<video><source src="https://evil.test/v2.mp4"></video>
<video><source src="local.mp4"></video>
<track src="https://evil.test/t.vtt">
<track src="local.vtt">
</body></html>`,
      })
    );
    const res = await postBuild({ mode: "static" });
    const zip = await buildZip(res.status, res);
    const html = await zipText(zip, "mi-landing/index.html");

    expect(html).not.toContain("evil.test");
    expect(html.toLowerCase()).not.toContain("http-equiv");
    expect(html).toContain("local-frame.html");
    expect(html).toContain("local.swf");
    expect(html).toContain("local.mp4");
    expect(html).toContain("local.vtt");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes remote @import rules and never fetches them", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<html><head><style>
@import url("https://cdn.test/a.css");
@import 'https://cdn.test/b.css';
@import url(//cdn.test/c.css);
@import "local.css";
.x{background:url(https://img.test/p.png)}
</style></head><body></body></html>`,
        "styles.css": `@import url(https://cdn.test/d.css);
@import "local2.css";
.y{background:url(https://img.test/q.png)}`,
      })
    );
    const res = await postBuild({ mode: "static" });
    const zip = await buildZip(res.status, res);
    const html = await zipText(zip, "mi-landing/index.html");
    const css = await zipText(zip, "mi-landing/styles.css");

    const fetched = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(fetched.some((url) => url.includes("cdn.test"))).toBe(false);
    expect(fetched).toContain("https://img.test/p.png");
    expect(fetched).toContain("https://img.test/q.png");
    expect(fetched).toHaveLength(2);

    expect(html).not.toContain("cdn.test");
    expect(css).not.toContain("cdn.test");
    expect(html).toContain("local.css");
    expect(css).toContain("local2.css");
    expect(assetPaths(zip, "mi-landing")).toHaveLength(2);
  });
});

describe("stripRemoteImports on hostile CSS", () => {
  it("stays linear and still removes remote imports while keeping local ones", async () => {
    const { stripRemoteImports } = await import("@/lib/landing/build-images");
    const hostile = ["@import url(" + " ".repeat(200_000), ("@import url(" + "a".repeat(50)).repeat(4_000)];
    for (const css of hostile) {
      const started = Date.now();
      stripRemoteImports(css);
      expect(Date.now() - started).toBeLessThan(1_000);
    }
    const css = `@import url( "https://cdn.test/a.css" );@import '//cdn.test/b.css';@import "local.css";.x{color:red}`;
    expect(stripRemoteImports(css)).toBe(`@import "local.css";.x{color:red}`);
  });
});

describe("image collection on hostile CSS", () => {
  it("builds in linear time when styles.css holds an unterminated url( with a huge run", async () => {
    findUnique.mockResolvedValue(
      project({
        "index.html": `<html><head><link rel="stylesheet" href="styles.css"></head><body></body></html>`,
        "styles.css": ".a{background:url(" + " ".repeat(200_000) + "}",
      })
    );
    const started = Date.now();
    const res = await postBuild({ mode: "static" });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(res.status).toBe(200);
  });
});
