import { Router } from "express";
import { z } from "zod";
import { createSector, listSectors } from "@/lib/sectors";
import { cacheControl } from "@/lib/cache";
import { asyncHandler, validate, HttpError } from "@/lib/http";

/* ---------- Sectores ---------- */

export const sectorsRouter = Router();

// Catálogo estable tras auth → caché privada corta del navegador.
sectorsRouter.get(
  "/",
  cacheControl({ maxAge: 30 }),
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 9);
    res.json(await listSectors({ page, pageSize }));
  })
);

const sectorCreateSchema = z.object({ name: z.string().min(1) });

sectorsRouter.post(
  "/",
  validate.body(sectorCreateSchema),
  asyncHandler(async (req, res) => {
    const { name } = req.validatedBody as z.infer<typeof sectorCreateSchema>;
    try {
      res.status(201).json(await createSector(name));
    } catch (e) {
      // createSector lanza con mensaje de negocio (p. ej. duplicado) → 400.
      throw new HttpError(400, e instanceof Error ? e.message : "Error al ingresar el sector");
    }
  })
);
