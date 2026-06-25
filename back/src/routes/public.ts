import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { processNewLead } from "@/lib/notifications";
import { leadsLimiter } from "@/lib/limiters";
import { logger } from "@/lib/logger";

/* ---------- Leads de la landing pública 3A Estudio ---------- */

export const publicRouter = Router();

publicRouter.post("/leads", leadsLimiter, async (req, res) => {
  const parsed = z
    .object({
      name: z.string().min(2, "Indica tu nombre"),
      email: z.string().email("Email no válido"),
      phone: z.string().min(6, "Teléfono no válido"),
      message: z.string().trim().max(2000).optional(),
      consent: z.literal(true, {
        errorMap: () => ({ message: "Debes aceptar la política de privacidad" }),
      }),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos no válidos" });
  }

  try {
    const lead = await prisma.landingLead.create({ data: parsed.data });
    // Hook best-effort: contacto en agenda + email al admin. NUNCA bloquea ni
    // rompe la creación del lead (processNewLead captura todos los errores).
    processNewLead({
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      message: lead.message,
      source: "landing",
    }).catch((e) => logger.error({ err: e }, "[leads] hook nuevo lead:"));
    res.status(201).json({ ok: true, id: lead.id });
  } catch {
    res.status(500).json({ error: "No se pudo guardar el lead" });
  }
});

publicRouter.get("/leads", async (_req, res) => {
  // Gate in index.ts already enforces authentication for GET /api/public/leads
  // (only POST /api/public/leads is in PUBLIC_RULES). req.user is set by the gate.
  res.json(await prisma.landingLead.findMany({ orderBy: { createdAt: "desc" } }));
});
