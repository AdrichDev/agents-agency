import { Router } from "express";
import { ingestWebsite } from "@/lib/scraper/web";
import { chunkText } from "@/lib/embeddings";
import { saveChunkWithDuplicatePolicy } from "@/lib/knowledge-duplicates";
import { asyncHandler, HttpError } from "@/lib/http";

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
