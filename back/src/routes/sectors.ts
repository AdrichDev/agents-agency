import { Router } from "express";
import { z } from "zod";
import { createSector, listSectors } from "@/lib/sectors";
import { cacheControl } from "@/lib/cache";

/* ---------- Sectores ---------- */

export const sectorsRouter = Router();

// Catálogo estable tras auth → caché privada corta del navegador.
sectorsRouter.get("/", cacheControl({ maxAge: 30 }), async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 9);
  res.json(await listSectors({ page, pageSize }));
});

sectorsRouter.post("/", async (req, res) => {
  const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await createSector(parsed.data.name));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Error al ingresar el sector" });
  }
});
