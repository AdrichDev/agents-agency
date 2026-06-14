import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { processNewLead } from "@/lib/notifications";
import { leadsLimiter } from "@/lib/limiters";

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
    }).catch((e) => console.error("[leads] hook nuevo lead:", e));
    res.status(201).json({ ok: true, id: lead.id });
  } catch {
    res.status(500).json({ error: "No se pudo guardar el lead" });
  }
});

publicRouter.get("/leads", async (req, res) => {
  // Solo usuarios logados pueden listar leads
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: "No autenticado" });
  res.json(await prisma.landingLead.findMany({ orderBy: { createdAt: "desc" } }));
});
