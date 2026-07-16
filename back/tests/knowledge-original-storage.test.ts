/**
 * T5 (aa-agent-backend-foundation, validation.md, AC7) — originales de
 * conocimiento en el bucket privado `kb-files/<agentId>/`:
 *  - Subir un adjunto guarda el ORIGINAL en Storage además de los chunks.
 *  - Un fallo de Storage NO bloquea la indexación (best-effort con nota).
 *  - Borrar la fuente hace GC del original.
 *  - Los nombres de objeto se sanean (sin path traversal ni chars inválidos).
 *  - La re-ingesta manual de la web inicial refresca su estado visible.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    knowledgeChunk: {
      groupBy: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
    },
  },
}));
vi.mock("@/lib/scraper/web", () => ({
  ingestWebsite: vi.fn().mockResolvedValue({ pages: 4, chunks: 12, duplicates: 0, requiresConfirmation: false }),
}));
vi.mock("@/lib/embeddings", () => ({
  chunkText: vi.fn((text: string) => [text]),
}));
vi.mock("@/lib/knowledge-duplicates", () => ({
  saveChunkWithDuplicatePolicy: vi.fn().mockResolvedValue("saved"),
}));
vi.mock("@/lib/limiters", () => ({
  heavyLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("@/lib/scraper/file", () => ({
  parseFile: vi.fn(async (name: string, buffer: Buffer) => [
    { source: name, text: buffer.toString("utf8") },
  ]),
}));
vi.mock("@/lib/agent/service", () => ({
  refreshInitialIngestStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    uploadKbOriginal: vi.fn().mockResolvedValue("agent-1/notas.txt"),
    deleteKbOriginal: vi.fn().mockResolvedValue(undefined),
  };
});

import { prisma } from "@/lib/db";
import { ingestWebsite } from "@/lib/scraper/web";
import { refreshInitialIngestStatus } from "@/lib/agent/service";
import { uploadKbOriginal, deleteKbOriginal, kbObjectName, kbObjectPath } from "@/lib/storage";
import { knowledgeRouter } from "@/routes/knowledge";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/knowledge", knowledgeRouter);
  return app;
}

// HTTP helper (no supertest dependency — mirrors existing test pattern).
function request(
  app: express.Express,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: Buffer | string } = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        { host: "127.0.0.1", port, method, path, headers: opts.headers ?? {} },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            let body: any = null;
            try {
              body = data ? JSON.parse(data) : null;
            } catch {
              body = data;
            }
            resolve({ status: res.statusCode ?? 0, body });
          });
        }
      );
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      if (opts.body) req.write(opts.body);
      req.end();
    });
  });
}

function jsonRequest(app: express.Express, method: string, path: string, payload: unknown) {
  const body = JSON.stringify(payload);
  return request(app, method, path, {
    headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
    body,
  });
}

/** Cuerpo multipart mínimo con un archivo en el campo "files" (lo parsea multer). */
function multipartUpload(app: express.Express, path: string, filename: string, content: Buffer) {
  const boundary = "----vitestboundary42";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return request(app, "POST", path, {
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("kbObjectName/kbObjectPath — saneado del nombre de objeto", () => {
  it("elimina separadores de ruta (sin path traversal) y chars inválidos", () => {
    expect(kbObjectName("../../etc/passwd")).not.toContain("/");
    expect(kbObjectName("informe final ñ.pdf")).toBe("informe_final_.pdf");
    expect(kbObjectPath("agent-1", "notas.txt")).toBe("agent-1/notas.txt");
  });
});

describe("POST /api/knowledge/:agentId/files — original en kb-files (AC7)", () => {
  it("guarda el ORIGINAL en el bucket privado además de los chunks", async () => {
    const res = await multipartUpload(
      buildApp(),
      "/api/knowledge/agent-1/files",
      "notas.txt",
      Buffer.from("contenido del documento")
    );

    expect(res.status).toBe(200);
    expect(res.body.files[0]).toMatchObject({ source: "notas.txt", chunks: 1 });
    expect(uploadKbOriginal).toHaveBeenCalledTimes(1);
    const [agentId, source, buffer, contentType] = asMock(uploadKbOriginal).mock.calls[0];
    expect(agentId).toBe("agent-1");
    expect(source).toBe("notas.txt");
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect((buffer as Buffer).toString("utf8")).toBe("contenido del documento");
    expect(contentType).toBe("text/plain");
  });

  it("un fallo de Storage NO bloquea la indexación: chunks guardados + nota honesta", async () => {
    asMock(uploadKbOriginal).mockRejectedValueOnce(new Error("bucket kb-files no existe"));

    const res = await multipartUpload(
      buildApp(),
      "/api/knowledge/agent-1/files",
      "doc.txt",
      Buffer.from("texto indexable")
    );

    expect(res.status).toBe(200);
    expect(res.body.files[0].chunks).toBe(1);
    expect(res.body.files[0].note).toContain("Original no guardado");
  });

  it("archivo que no parsea: NO se sube original (no habrá chunks que lo referencien)", async () => {
    const { parseFile } = await import("@/lib/scraper/file");
    asMock(parseFile).mockRejectedValueOnce(new Error("Formato no soportado"));

    const res = await multipartUpload(
      buildApp(),
      "/api/knowledge/agent-1/files",
      "raro.bin",
      Buffer.from("???")
    );

    expect(res.status).toBe(200);
    expect(uploadKbOriginal).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/knowledge/:agentId/sources — GC del original (AC7)", () => {
  it("borra los chunks Y el original del bucket privado", async () => {
    const res = await jsonRequest(buildApp(), "DELETE", "/api/knowledge/agent-1/sources", {
      source: "notas.txt",
    });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(3);
    expect(prisma.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
      where: { agentId: "agent-1", source: "notas.txt" },
    });
    expect(deleteKbOriginal).toHaveBeenCalledWith("agent-1", "notas.txt");
  });
});

describe("POST /api/knowledge (url) — estado visible de la web inicial", () => {
  it("tras re-ingestar por URL refresca el estado de la web inicial (best-effort)", async () => {
    const res = await jsonRequest(buildApp(), "POST", "/api/knowledge", {
      agentId: "agent-1",
      url: "https://clinicanorte.example",
    });

    expect(res.status).toBe(200);
    expect(ingestWebsite).toHaveBeenCalledWith("agent-1", "https://clinicanorte.example", true, {
      duplicatePolicy: "ask",
    });
    expect(refreshInitialIngestStatus).toHaveBeenCalledWith(
      "agent-1",
      "https://clinicanorte.example",
      expect.objectContaining({ pages: 4, chunks: 12 })
    );
  });

  it("un fallo del refresh del estado no rompe la respuesta de la ingesta", async () => {
    asMock(refreshInitialIngestStatus).mockRejectedValueOnce(new Error("db down"));

    const res = await jsonRequest(buildApp(), "POST", "/api/knowledge", {
      agentId: "agent-1",
      url: "https://clinicanorte.example",
    });

    expect(res.status).toBe(200);
    expect(res.body.chunks).toBe(12);
  });
});
