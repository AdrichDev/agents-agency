import path from "path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "@/lib/db";
import { ingestWebsite } from "@/lib/scraper/web";
import { chunkText } from "@/lib/embeddings";
import { saveChunkWithDuplicatePolicy } from "@/lib/knowledge-duplicates";
import { asyncHandler, HttpError } from "@/lib/http";
import { heavyLimiter } from "@/lib/limiters";
import { parseFile } from "@/lib/scraper/file";

/* ---------- Conocimiento (RAG) ---------- */

export const knowledgeRouter = Router();

knowledgeRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { agentId, url, text, source, overwriteDuplicates } = req.body ?? {};
    if (!agentId) throw new HttpError(400, "agentId requerido");
    const duplicatePolicy =
      overwriteDuplicates === true ? "overwrite" : overwriteDuplicates === false ? "suffix" : "ask";

    if (url) return res.json(await ingestWebsite(agentId, url, true, { duplicatePolicy }));
    if (text) {
      const chunks = chunkText(text);
      let duplicates = 0;
      let saved = 0;
      for (const c of chunks) {
        const result = await saveChunkWithDuplicatePolicy(agentId, source ?? "documento", c, duplicatePolicy);
        if (result === "duplicate") duplicates++;
        else saved++;
      }
      return res.json({ chunks: saved, duplicates, requiresConfirmation: duplicates > 0 });
    }
    throw new HttpError(400, "url o text requerido");
  })
);

/** Multer config: memory storage, 20 MB per file, max 10 files. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

/** Multipart file upload — indexes one or more files into the agent's knowledge base. */
knowledgeRouter.post(
  "/:agentId/files",
  heavyLimiter,
  (req, res, next) => {
    upload.array("files")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") return next(new HttpError(413, "Archivo demasiado grande (máx 20 MB)"));
        if (err.code === "LIMIT_FILE_COUNT") return next(new HttpError(400, "Demasiados archivos (máx 10)"));
        return next(new HttpError(400, err.message));
      }
      next(err);
    });
  },
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    if (!agentId) throw new HttpError(400, "agentId requerido");

    const overwriteField = (req.body as Record<string, string>)?.overwriteDuplicates;
    const duplicatePolicy =
      overwriteField === "true" ? "overwrite" : overwriteField === "false" ? "suffix" : "ask";

    const files = (req.files ?? []) as Express.Multer.File[];

    type FileResult = {
      source: string;
      chunks: number;
      duplicates: number;
      note?: string;
    };

    const results: FileResult[] = [];

    for (const file of files) {
      const source = path.basename(file.originalname);
      let entries: { source: string; text: string }[];

      try {
        entries = await parseFile(file.originalname, file.buffer);
      } catch (err: unknown) {
        // Per-file failure: skip with note, don't fail the whole request.
        const msg = err instanceof Error ? err.message : "Error al parsear";
        results.push({ source, chunks: 0, duplicates: 0, note: msg });
        continue;
      }

      if (entries.length === 0) {
        results.push({ source, chunks: 0, duplicates: 0, note: "Archivo vacío o sin contenido" });
        continue;
      }

      // Aggregate across all entries (for zip: multiple {source, text} pairs).
      for (const entry of entries) {
        const chunks = chunkText(entry.text);
        let saved = 0;
        let duplicates = 0;
        for (const chunk of chunks) {
          const result = await saveChunkWithDuplicatePolicy(agentId, entry.source, chunk, duplicatePolicy);
          if (result === "duplicate") duplicates++;
          else saved++;
        }
        // Find or create aggregate entry for this source.
        const existing = results.find((r) => r.source === entry.source);
        if (existing) {
          existing.chunks += saved;
          existing.duplicates += duplicates;
        } else {
          results.push({ source: entry.source, chunks: saved, duplicates });
        }
      }
    }

    const requiresConfirmation =
      duplicatePolicy === "ask" && results.some((r) => r.duplicates > 0);

    return res.json({ files: results, requiresConfirmation });
  })
);

/** Lista las fuentes indexadas de un agente con su nº de chunks. */
knowledgeRouter.get(
  "/:agentId/sources",
  asyncHandler(async (req, res) => {
    const grouped = await prisma.knowledgeChunk.groupBy({
      by: ["source"],
      where: { agentId: req.params.agentId },
      _count: { _all: true },
    });
    const sources = grouped
      .map((g) => ({ source: g.source, chunks: g._count._all }))
      .sort((a, b) => a.source.localeCompare(b.source));
    res.json({ sources });
  })
);

/** Borra todos los chunks de una fuente concreta de un agente. */
knowledgeRouter.delete(
  "/:agentId/sources",
  asyncHandler(async (req, res) => {
    const { source } = req.body ?? {};
    if (!source) throw new HttpError(400, "source requerido");
    const result = await prisma.knowledgeChunk.deleteMany({
      where: { agentId: req.params.agentId, source },
    });
    res.json({ deleted: result.count });
  })
);
