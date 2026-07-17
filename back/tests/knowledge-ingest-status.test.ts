/**
 * T2.1 (aa-knowledge-progreso-indexado) — GET /api/knowledge/:agentId/ingest-status.
 *
 * Endpoint LIGERO para polling del front: lee ecommerceConfig.initialIngest y
 * devuelve { status, progress?, chunks?, reason?, url? } sin secretos. Agente sin
 * ingesta → { status: "none" } (neutro, no rompe). Gate: la ruta NO está en la
 * allowlist pública (queda protegida por el gate central de /api).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: { agent: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/embeddings", () => ({
  chunkText: vi.fn((t: string) => [t]),
  searchKnowledge: vi.fn(),
}));
vi.mock("@/lib/scraper/web", () => ({ ingestWebsite: vi.fn() }));
vi.mock("@/lib/knowledge-duplicates", () => ({ saveChunkWithDuplicatePolicy: vi.fn() }));
vi.mock("@/lib/limiters", () => ({
  heavyLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("@/lib/scraper/file", () => ({ parseFile: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  uploadKbOriginal: vi.fn(),
  deleteKbOriginal: vi.fn(),
}));
vi.mock("@/lib/agent/service", () => ({ runTrackedIngest: vi.fn() }));

import { prisma } from "@/lib/db";
import { knowledgeRouter } from "@/routes/knowledge";
import { isPublic } from "@/lib/public-routes";
import type { HttpError } from "@/lib/http";

const findUnique = prisma.agent.findUnique as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/knowledge", knowledgeRouter);
  app.use((err: HttpError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  return app;
}

function getRequest(app: express.Express, path: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
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
      req.end();
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/knowledge/:agentId/ingest-status — estado ligero (T2.1)", () => {
  it("devuelve status + progress mientras indexa", async () => {
    findUnique.mockResolvedValue({
      ecommerceConfig: {
        initialIngest: { url: "https://negocio.test", status: "pending", progress: { pagesDone: 3, pagesTotal: 9 } },
      },
    });
    const app = buildApp();

    const res = await getRequest(app, "/api/knowledge/a1/ingest-status");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
    expect(res.body.progress).toEqual({ pagesDone: 3, pagesTotal: 9 });
    expect(res.body.url).toBe("https://negocio.test");
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "a1" }, select: { ecommerceConfig: true } });
  });

  it("estado final: devuelve chunks y sin progress", async () => {
    findUnique.mockResolvedValue({
      ecommerceConfig: {
        initialIngest: { url: "https://negocio.test", status: "indexed", pages: 4, chunks: 20 },
      },
    });
    const app = buildApp();

    const res = await getRequest(app, "/api/knowledge/a1/ingest-status");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("indexed");
    expect(res.body.chunks).toBe(20);
    expect(res.body.progress).toBeUndefined();
  });

  it("agente sin initialIngest → { status: 'none' } (neutro, no rompe)", async () => {
    findUnique.mockResolvedValue({ ecommerceConfig: {} });
    const app = buildApp();

    const res = await getRequest(app, "/api/knowledge/a1/ingest-status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "none" });
  });

  it("agente inexistente (config null) → { status: 'none' } sin romper", async () => {
    findUnique.mockResolvedValue(null);
    const app = buildApp();

    const res = await getRequest(app, "/api/knowledge/a1/ingest-status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "none" });
  });

  it("gate: la ruta NO es pública (requiere sesión)", () => {
    expect(isPublic("GET", "/api/knowledge/a1/ingest-status")).toBe(false);
  });
});
