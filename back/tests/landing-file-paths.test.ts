/**
 * Rutas seguras en el mapa de ficheros de una landing (S1).
 *
 * Toda clave de `files` es una ruta relativa POSIX: nunca absoluta, nunca con `..`/`.`,
 * nunca con barras invertidas, bytes de control, segmentos vacíos, `node_modules/` ni más
 * de 6 niveles. El mapa SÍ acepta `.env` (lo escribe el SetupWizard) pero el build excluye
 * los ficheros que empiezan por `.` (`isDotfilePath`).
 *
 * Hermético: express local + `rawRequest`, `@/lib/db`, `@/lib/openai` y `@/lib/limiters`
 * mockeados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

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

import { prisma } from "@/lib/db";
import { openai } from "@/lib/openai";
import { landingRouter } from "@/routes/landing";
import { errorHandler } from "@/lib/observability";
import { MAX_FILES_BYTES } from "@/lib/landing/llm-files";
import {
  isSafeFilePath,
  filterSafeFiles,
  isDotfilePath,
} from "@/lib/landing/paths";

const findUnique = prisma.landingProject.findUnique as ReturnType<typeof vi.fn>;
const update = prisma.landingProject.update as ReturnType<typeof vi.fn>;
const mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;

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
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const headers: Record<string, string> = {};
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          server.close();
          let parsed: any = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      });
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      if (body) req.write(body);
      req.end();
    });
  });
}

const PROJECT = {
  id: "p1",
  business: null,
  files: { "index.html": "<html>old</html>" },
  generationPrompt: "Landing de panadería",
  dbProvider: "none",
};

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(PROJECT);
  update.mockResolvedValue({});
});

// ── isSafeFilePath ───────────────────────────────────────────────────────────

describe("isSafeFilePath", () => {
  it.each([
    "index.html",
    "assets/a.webp",
    "styles.css",
    ".env",
    "a/b/c/d/e/f",
  ])("accepts the relative POSIX path %s", (path) => {
    expect(isSafeFilePath(path)).toBe(true);
  });

  it.each([
    ["", "empty string"],
    ["/x", "absolute POSIX path"],
    ["/etc/passwd", "absolute POSIX path"],
    ["C:\\x", "absolute Windows path"],
    ["C:/x", "absolute Windows path"],
    ["c:/x", "absolute Windows path"],
    ["..", "parent segment"],
    ["../x", "parent segment"],
    ["a/../b", "parent segment"],
    [".", "current segment"],
    ["./a", "current segment"],
    ["a/./b", "current segment"],
    ["a\\b", "backslash"],
    ["assets\\a.webp", "backslash"],
    ["a\u0000b", "control byte"],
    ["a\u001fb", "control byte"],
    ["a\u007fb", "control byte"],
    ["a//b", "empty segment"],
    ["a/b/", "empty segment"],
    ["node_modules/x", "node_modules"],
    ["assets/node_modules/x", "node_modules"],
    ["a/b/c/d/e/f/g", "7 levels"],
  ])("rejects %s (%s)", (path) => {
    expect(isSafeFilePath(path)).toBe(false);
  });

  it("treats the depth boundary exactly: 6 levels accepted, 7 rejected", () => {
    expect(isSafeFilePath("a/b/c/d/e/f")).toBe(true);
    expect(isSafeFilePath("a/b/c/d/e/f/g")).toBe(false);
  });
});

// ── filterSafeFiles ──────────────────────────────────────────────────────────

describe("isSafeFilePath — disk-write hardening (S1, L5)", () => {
  it("rejects Windows reserved device names in any segment, with or without extension", () => {
    for (const p of ["con", "CON/x", "aux.html", "nul.js", "com1.txt", "lpt9/x", "assets/prn.webp"]) {
      expect(isSafeFilePath(p), p).toBe(false);
    }
    expect(isSafeFilePath("console.js")).toBe(true);
    expect(isSafeFilePath("assets/com10.webp")).toBe(true);
  });

  it("rejects segments that end in a dot or a space, or start with a space", () => {
    for (const p of ["a./b", "x.", "a /b", "x ", " x"]) expect(isSafeFilePath(p), p).toBe(false);
  });

  it("caps each segment at 255 characters and the whole path at 512", () => {
    expect(isSafeFilePath("a".repeat(255))).toBe(true);
    expect(isSafeFilePath("a".repeat(256))).toBe(false);
    const longPath = ["a".repeat(200), "b".repeat(200), "c".repeat(111)].join("/");
    expect(longPath.length).toBe(513);
    expect(isSafeFilePath(longPath)).toBe(false);
    expect(isSafeFilePath(longPath.slice(0, 512))).toBe(true);
  });

  it("rejects prototype keys so a file can never vanish silently", () => {
    for (const p of ["__proto__", "constructor", "prototype", "a/__proto__"]) {
      expect(isSafeFilePath(p), p).toBe(false);
    }
    const { files, dropped } = filterSafeFiles(JSON.parse('{"__proto__":"x","index.html":"<p>"}'));
    expect(Object.keys(files)).toEqual(["index.html"]);
    expect(dropped).toEqual(["__proto__"]);
  });
});

describe("filterSafeFiles", () => {
  it("drops the invalid keys, keeps the valid ones and reports the dropped list", () => {
    const files = {
      "index.html": "<html/>",
      "../evil.js": "alert(1)",
      "assets/a.webp": "data",
      "/etc/passwd": "root",
      ".env": "VITE_X=1",
      "a//b": "x",
    };

    const result = filterSafeFiles(files);

    expect(result.files).toEqual({
      "index.html": "<html/>",
      "assets/a.webp": "data",
      ".env": "VITE_X=1",
    });
    expect(result.dropped).toEqual(["../evil.js", "/etc/passwd", "a//b"]);
    // El mapa de entrada no se muta.
    expect(Object.keys(files)).toHaveLength(6);
  });

  it("reports nothing dropped for an all-valid map", () => {
    const result = filterSafeFiles({ "index.html": "<html/>", ".env": "A=1" });
    expect(result.dropped).toEqual([]);
    expect(Object.keys(result.files)).toHaveLength(2);
  });
});

// ── isDotfilePath ────────────────────────────────────────────────────────────

describe("isDotfilePath", () => {
  it("flags any path with a segment starting with a dot", () => {
    expect(isDotfilePath(".env")).toBe(true);
    expect(isDotfilePath("assets/.hidden.webp")).toBe(true);
    expect(isDotfilePath(".well-known/x")).toBe(true);
  });

  it("does not flag ordinary files", () => {
    expect(isDotfilePath("index.html")).toBe(false);
    expect(isDotfilePath("assets/a.webp")).toBe(false);
    expect(isDotfilePath("a/b/c/d/e/f")).toBe(false);
  });
});

// ── PATCH /api/landing/:id/files ─────────────────────────────────────────────

describe("PATCH /api/landing/:id/files", () => {
  it("rejects an unsafe key with 400 INVALID_FILE_PATH and persists nothing", async () => {
    const res = await rawRequest(buildApp(), "PATCH", "/api/landing/p1/files", {
      files: { "index.html": "<html/>", "../x": "evil" },
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_FILE_PATH");
    expect(res.body.details.paths).toEqual(["../x"]);
    expect(update).not.toHaveBeenCalled();
  });

  it("accepts a valid map that includes .env (the SetupWizard writes it)", async () => {
    const files = {
      "index.html": "<html>ok</html>",
      ".env": "VITE_SUPABASE_URL=https://x.test",
      "assets/a.webp": "binary",
    };

    const res = await rawRequest(buildApp(), "PATCH", "/api/landing/p1/files", { files });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, truncated: false });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.files).toEqual(files);
  });

  it("still answers ok:false on an oversized payload without saving", async () => {
    const res = await rawRequest(buildApp(), "PATCH", "/api/landing/p1/files", {
      files: { "index.html": "x".repeat(MAX_FILES_BYTES + 1000) },
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.truncated).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
});

// ── generate / regenerate / db-provider ──────────────────────────────────────

describe("model output with unsafe paths", () => {
  it("drops them on POST /:id/generate instead of failing the request", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              "index.html": "<html>generated</html>",
              "../evil.js": "alert('xss')",
              "assets/a.webp": "binary",
            }),
          },
        },
      ],
    });

    const res = await rawRequest(buildApp(), "POST", "/api/landing/p1/generate", {
      generationPrompt: "Landing de panadería",
      dbProvider: "none",
    });

    expect(res.status).toBe(200);
    expect(res.body.files).toEqual({
      "index.html": "<html>generated</html>",
      "assets/a.webp": "binary",
    });
    expect(update.mock.calls[0][0].data.files).toEqual({
      "index.html": "<html>generated</html>",
      "assets/a.webp": "binary",
    });
  });

  it("drops them on POST /:id/regenerate and never persists them", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              "index.html": "<html>new</html>",
              "../../etc/passwd": "root",
            }),
          },
        },
      ],
    });

    const res = await rawRequest(buildApp(), "POST", "/api/landing/p1/regenerate", {
      feedback: "Cambia el titular",
    });

    expect(res.status).toBe(200);
    expect(res.body.files).toEqual({ "index.html": "<html>new</html>" });
    const saved = update.mock.calls[0][0].data.files;
    expect(saved).toEqual({ "index.html": "<html>new</html>" });
  });

  it("drops them on POST /:id/db-provider merge", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              "index.html": "<html>with data layer</html>",
              "node_modules/leak.js": "x",
            }),
          },
        },
      ],
    });

    const res = await rawRequest(buildApp(), "POST", "/api/landing/p1/db-provider", {
      dbProvider: "webhook",
      confirm: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.files).toEqual({ "index.html": "<html>with data layer</html>" });
    expect(update.mock.calls[0][0].data.files).toEqual({
      "index.html": "<html>with data layer</html>",
    });
  });
});
