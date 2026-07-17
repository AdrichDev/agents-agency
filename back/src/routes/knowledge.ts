import path from "path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "@/lib/db";
import { chunkText, searchKnowledge } from "@/lib/embeddings";
import { saveChunkWithDuplicatePolicy } from "@/lib/knowledge-duplicates";
import { asyncHandler, HttpError } from "@/lib/http";
import { heavyLimiter } from "@/lib/limiters";
import { parseFile } from "@/lib/scraper/file";
import { uploadKbOriginal, deleteKbOriginal } from "@/lib/storage";
import { runTrackedIngest, type InitialIngestRecord } from "@/lib/agent/service";

/* ---------- Conocimiento (RAG) ---------- */

export const knowledgeRouter = Router();

knowledgeRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { agentId, url, text, source, overwriteDuplicates } = req.body ?? {};
    if (!agentId) throw new HttpError(400, "agentId requerido");
    const duplicatePolicy =
      overwriteDuplicates === true ? "overwrite" : overwriteDuplicates === false ? "suffix" : "ask";

    if (url) {
      // F1 (aa-knowledge-progreso-indexado): la re-indexación MANUAL usa el MISMO
      // mecanismo con progreso que la auto-ingesta al crear el agente — marca
      // `pending` ANTES de empezar, emite `progress` por página y escribe el
      // estado final. Así la tab Conocimiento muestra la animación, el % y el
      // refresco en vivo (polling) en vez del texto estático + salto al resultado.
      // La respuesta sigue devolviendo el IngestResult (chunks/pages) que hoy
      // consume el front para kbStatus.
      const result = await runTrackedIngest(agentId, url, { duplicatePolicy });
      return res.json(result);
    }
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

      // F5 (AC7): guardar el archivo ORIGINAL en el bucket privado
      // `kb-files/<agentId>/` además de los chunks. Best-effort con nota: un
      // fallo de Storage no bloquea la indexación (los chunks sí se guardan).
      // Nota zip: se guarda el .zip entero bajo su propio nombre; las fuentes
      // internas no tienen original individual (GC del zip = manual).
      let originalNote: string | undefined;
      try {
        await uploadKbOriginal(agentId, source, file.buffer, file.mimetype || "application/octet-stream");
      } catch (err: unknown) {
        originalNote = `Original no guardado en Storage: ${err instanceof Error ? err.message : "error"}`;
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

      // Anotar el fallo de guardado del original en el resultado del archivo.
      if (originalNote) {
        const entry = results.find((r) => r.source === source) ?? results[results.length - 1];
        if (entry && !entry.note) entry.note = originalNote;
      }
    }

    const requiresConfirmation =
      duplicatePolicy === "ask" && results.some((r) => r.duplicates > 0);

    return res.json({ files: results, requiresConfirmation });
  })
);

/**
 * F5 (RAG visible): devuelve lo que el agente recuperaría ante una pregunta —
 * fuente + snippet + % de similitud. Gated por el gate central de /api (sesión
 * del tenant); no está en la allowlist pública. Permite al operador y a la
 * consola verificar que el RAG funciona de verdad.
 */
knowledgeRouter.post(
  "/:agentId/search",
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    if (!agentId) throw new HttpError(400, "agentId requerido");
    const { query, k } = req.body ?? {};
    if (!query || typeof query !== "string" || !query.trim()) {
      throw new HttpError(400, "query requerido");
    }
    // k acotado a [1,20]; por defecto 5 (mismo default que searchKnowledge).
    const topK = Number.isInteger(k) && k > 0 && k <= 20 ? k : 5;
    const rows = await searchKnowledge(agentId, query, topK);
    const results = rows.map((r) => ({
      source: r.source,
      snippet: r.content.slice(0, 200),
      // distancia coseno (0=idéntico, 2=opuesto) → % de similitud legible.
      similarity: Math.round((1 - r.distance) * 100),
    }));
    // Sin conocimiento → lista vacía, nunca error.
    res.json({ results });
  })
);

/**
 * F1/F2 (aa-knowledge-progreso-indexado): estado LIGERO de la ingesta de la web
 * inicial para polling barato del front (~2s) sin recargar el agente entero. Lee
 * solo `ecommerceConfig.initialIngest` y devuelve el subconjunto visible
 * (status/progress/chunks/reason/url) — sin secretos. Agente sin ingesta →
 * `{ status: "none" }` (respuesta neutra, no rompe). Gated por el gate central de
 * /api (la ruta NO está en la allowlist pública).
 */
knowledgeRouter.get(
  "/:agentId/ingest-status",
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    if (!agentId) throw new HttpError(400, "agentId requerido");
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { ecommerceConfig: true },
    });
    const config = (agent?.ecommerceConfig as Record<string, unknown> | null) ?? {};
    const initialIngest = (config as { initialIngest?: InitialIngestRecord }).initialIngest;
    if (!initialIngest) return res.json({ status: "none" });
    // Solo el subconjunto visible; `undefined` se omite en el JSON.
    const { status, progress, chunks, reason, url } = initialIngest;
    return res.json({ status, progress, chunks, reason, url });
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

/** Borra todos los chunks de una fuente concreta de un agente + GC del original. */
knowledgeRouter.delete(
  "/:agentId/sources",
  asyncHandler(async (req, res) => {
    const { source } = req.body ?? {};
    if (!source) throw new HttpError(400, "source requerido");
    const result = await prisma.knowledgeChunk.deleteMany({
      where: { agentId: req.params.agentId, source },
    });
    // F5 (AC7): GC del archivo original en kb-files/<agentId>/ (best-effort).
    await deleteKbOriginal(req.params.agentId, source);
    res.json({ deleted: result.count });
  })
);
