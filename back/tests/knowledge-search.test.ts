/**
 * F5 (aa-rag-extraccion-estatica-honesta) — RAG visible.
 *
 * POST /api/knowledge/:agentId/search devuelve fuente + snippet (≤200) +
 * similarity (round((1-distance)*100)); sin conocimiento → [] sin error; query
 * ausente → 400. Gate: la ruta NO está en la allowlist pública (queda protegida
 * por el gate central de /api que exige sesión).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: { knowledgeChunk: { groupBy: vi.fn(), deleteMany: vi.fn() } },
}));
const searchKnowledge = vi.fn();
vi.mock("@/lib/embeddings", () => ({
  chunkText: vi.fn((t: string) => [t]),
  searchKnowledge: (...args: unknown[]) => searchKnowledge(...args),
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
vi.mock("@/lib/agent/service", () => ({ refreshInitialIngestStatus: vi.fn() }));

import { knowledgeRouter } from "@/routes/knowledge";
import { isPublic } from "@/lib/public-routes";
import type { HttpError } from "@/lib/http";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/knowledge", knowledgeRouter);
  // Error handler mínimo que mapea HttpError → status (como el server real).
  app.use((err: HttpError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  return app;
}

function jsonRequest(app: express.Express, method: string, path: string, payload: unknown) {
  const body = JSON.stringify(payload);
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
        },
        (res) => {
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
        }
      );
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      req.write(body);
      req.end();
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/knowledge/:agentId/search — RAG visible (F5)", () => {
  it("devuelve fuente + snippet (≤200) + similarity", async () => {
    searchKnowledge.mockResolvedValue([
      { source: "web:home", content: "x".repeat(300), distance: 0.1 },
      { source: "faq.pdf", content: "Horario de 9 a 14", distance: 0.4 },
    ]);
    const app = buildApp();

    const res = await jsonRequest(app, "POST", "/api/knowledge/a1/search", { query: "horario" });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0]).toEqual({
      source: "web:home",
      snippet: "x".repeat(200),
      similarity: 90,
    });
    expect(res.body.results[0].snippet.length).toBe(200);
    expect(res.body.results[1].similarity).toBe(60);
    expect(searchKnowledge).toHaveBeenCalledWith("a1", "horario", 5);
  });

  it("acota k al rango [1,20]", async () => {
    searchKnowledge.mockResolvedValue([]);
    const app = buildApp();

    await jsonRequest(app, "POST", "/api/knowledge/a1/search", { query: "q", k: 3 });

    expect(searchKnowledge).toHaveBeenCalledWith("a1", "q", 3);
  });

  it("sin conocimiento → lista vacía, sin error", async () => {
    searchKnowledge.mockResolvedValue([]);
    const app = buildApp();

    const res = await jsonRequest(app, "POST", "/api/knowledge/a1/search", { query: "nada" });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it("query ausente → 400", async () => {
    const app = buildApp();

    const res = await jsonRequest(app, "POST", "/api/knowledge/a1/search", {});

    expect(res.status).toBe(400);
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  it("gate: la ruta NO es pública (requiere sesión)", () => {
    expect(isPublic("POST", "/api/knowledge/a1/search")).toBe(false);
  });
});
