import { Router } from "express";
import { ingestWebsite } from "@/lib/scraper/web";
import { chunkText } from "@/lib/embeddings";
import { saveChunkWithDuplicatePolicy } from "@/lib/knowledge-duplicates";

/* ---------- Conocimiento (RAG) ---------- */

export const knowledgeRouter = Router();

knowledgeRouter.post("/", async (req, res) => {
  const { agentId, url, text, source, overwriteDuplicates } = req.body ?? {};
  if (!agentId) return res.status(400).json({ error: "agentId requerido" });
  const duplicatePolicy =
    overwriteDuplicates === true ? "overwrite" : overwriteDuplicates === false ? "suffix" : "ask";
  try {
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
    res.status(400).json({ error: "url o text requerido" });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});
