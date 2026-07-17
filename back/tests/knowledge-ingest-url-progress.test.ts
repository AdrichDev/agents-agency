/**
 * (aa-knowledge-progreso-indexado) — POST /api/knowledge (camino URL) muestra
 * progreso EN VIVO igual que la auto-ingesta al crear el agente.
 *
 * Cierra el CRITICAL de verify: el botón "⟳ Re-indexar" (que POST-ea a este
 * endpoint) ahora dispara el MISMO mecanismo que la ingesta automática:
 *   1) escribe `initialIngest.status = "pending"` ANTES de empezar,
 *   2) emite `progress` por página vía el `onProgress` de ingestWebsite,
 *   3) tras `flush()` escribe el estado FINAL (indexed) sin `progress` obsoleto.
 *
 * Se usa el SERVICE REAL (runTrackedIngest) con prisma e ingestWebsite mockeados,
 * para verificar el cableado real de extremo a extremo (ruta → service).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// DB mockeada: writeInitialIngestStatus lee (findUnique) y escribe (update).
vi.mock("@/lib/db", () => ({
  prisma: { agent: { findUnique: vi.fn(), update: vi.fn() } },
}));
// n8n lo importa el service real; sin comportamiento en este flujo.
vi.mock("@/lib/n8n/client", () => ({ isConfigured: vi.fn(() => false) }));
// ingestWebsite mockeado: invoca onProgress por página y devuelve el IngestResult.
vi.mock("@/lib/scraper/web", () => ({ ingestWebsite: vi.fn() }));
// Dependencias directas de la ruta knowledge (no se ejercitan en el camino URL).
vi.mock("@/lib/embeddings", () => ({ chunkText: vi.fn((t: string) => [t]), searchKnowledge: vi.fn() }));
vi.mock("@/lib/knowledge-duplicates", () => ({ saveChunkWithDuplicatePolicy: vi.fn() }));
vi.mock("@/lib/limiters", () => ({
  heavyLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("@/lib/scraper/file", () => ({ parseFile: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  uploadKbOriginal: vi.fn(),
  deleteKbOriginal: vi.fn(),
  deleteKbFolder: vi.fn(),
  deletePublicAsset: vi.fn(),
  uploadImageDataUrl: vi.fn(),
  avatarAction: vi.fn(() => ({ kind: "noop" })),
}));

import { prisma } from "@/lib/db";
import { ingestWebsite } from "@/lib/scraper/web";
import { knowledgeRouter } from "@/routes/knowledge";
import type { HttpError } from "@/lib/http";

const findUnique = prisma.agent.findUnique as ReturnType<typeof vi.fn>;
const update = prisma.agent.update as ReturnType<typeof vi.fn>;
const ingestWebsiteMock = ingestWebsite as ReturnType<typeof vi.fn>;

const AGENT = "agent-1";
const URL = "https://negocio.test";

/** initialIngest escrito en la llamada `callIdx` a prisma.agent.update. */
function writtenRecord(callIdx: number) {
  const data = (update.mock.calls[callIdx][0] as { data: { ecommerceConfig: { initialIngest: any } } }).data;
  return data.ecommerceConfig.initialIngest;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/knowledge", knowledgeRouter);
  app.use((err: HttpError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  return app;
}

function postJson(app: express.Express, path: string, payload: unknown) {
  const body = JSON.stringify(payload);
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
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
  findUnique.mockResolvedValue({ ecommerceConfig: {} });
  update.mockResolvedValue({});
  // ingestWebsite emite progreso (0..total) y devuelve 12 chunks en 3 páginas.
  ingestWebsiteMock.mockImplementation(
    async (
      _agentId: string,
      _url: string,
      _crawl: boolean,
      opts?: { duplicatePolicy?: string; onProgress?: (done: number, total: number) => void }
    ) => {
      opts?.onProgress?.(0, 3);
      opts?.onProgress?.(1, 3);
      opts?.onProgress?.(2, 3);
      opts?.onProgress?.(3, 3);
      return { pages: 3, pagesAttempted: 3, chunks: 12, duplicates: 0, requiresConfirmation: false };
    }
  );
});

describe("POST /api/knowledge (url) — progreso en vivo (aa-knowledge-progreso-indexado)", () => {
  it("escribe status 'pending' ANTES de empezar, sin progress todavía", async () => {
    await postJson(buildApp(), "/api/knowledge", { agentId: AGENT, url: URL });

    // El PRIMER write es el estado pendiente inicial (antes de la primera página).
    const first = writtenRecord(0);
    expect(first.status).toBe("pending");
    expect(first.url).toBe(URL);
    expect(first.progress).toBeUndefined();
  });

  it("pasa un onProgress a ingestWebsite y persiste el avance como progress", async () => {
    await postJson(buildApp(), "/api/knowledge", { agentId: AGENT, url: URL });

    // ingestWebsite recibe el callback de progreso + la política de duplicados.
    expect(ingestWebsiteMock).toHaveBeenCalledWith(
      AGENT,
      URL,
      true,
      expect.objectContaining({ duplicatePolicy: "ask", onProgress: expect.any(Function) })
    );

    // Algún write intermedio refleja el progreso (pending + progress incremental).
    const progressWrites = update.mock.calls
      .map((_c, i) => writtenRecord(i))
      .filter((r) => r.status === "pending" && r.progress);
    expect(progressWrites.length).toBeGreaterThan(0);
    const last = progressWrites[progressWrites.length - 1];
    expect(last.progress).toEqual({ pagesDone: 3, pagesTotal: 3 });
  });

  it("tras flush escribe el estado final 'indexed' con chunks y SIN progress", async () => {
    const res = await postJson(buildApp(), "/api/knowledge", { agentId: AGENT, url: URL });

    // Respuesta HTTP: el IngestResult que hoy consume el front (chunks/pages).
    expect(res.status).toBe(200);
    expect(res.body.chunks).toBe(12);
    expect(res.body.pages).toBe(3);

    // El ÚLTIMO write es el estado terminal: indexed, con chunks, sin progress obsoleto.
    const final = writtenRecord(update.mock.calls.length - 1);
    expect(final.status).toBe("indexed");
    expect(final.chunks).toBe(12);
    expect(final.progress).toBeUndefined();
  });

  it("0 chunks → estado final 'empty' honesto (nunca indexed con 0)", async () => {
    ingestWebsiteMock.mockImplementationOnce(async (_a, _u, _c, opts?: any) => {
      opts?.onProgress?.(0, 1);
      opts?.onProgress?.(1, 1);
      return { pages: 0, pagesAttempted: 1, chunks: 0, duplicates: 0, requiresConfirmation: false, reason: "no_readable_text" };
    });

    await postJson(buildApp(), "/api/knowledge", { agentId: AGENT, url: URL });

    const final = writtenRecord(update.mock.calls.length - 1);
    expect(final.status).toBe("empty");
    expect(final.reason).toBe("no_readable_text");
    expect(final.progress).toBeUndefined();
  });
});
