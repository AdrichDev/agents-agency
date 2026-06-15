import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { processNewLead } from "@/lib/notifications";
import { leadsLimiter } from "@/lib/limiters";
import { getValidToken } from "@/lib/integrations/oauth";
import { createEvent } from "@/lib/integrations/calendar";

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

/* ---------- Reservas de landings (Google Calendar del negocio) ---------- */

// Endpoint público que el formulario de reserva de una landing generada invoca.
// Crea un evento en el Google Calendar del agente (negocio) dueño de la publicKey.
// Anti-abuso: rate-limit (leadsLimiter) + honeypot + validación estricta.
publicRouter.post("/reserve", leadsLimiter, async (req, res) => {
  const parsed = z
    .object({
      publicKey: z.string().min(1, "Falta la clave del negocio"),
      name: z.string().min(2, "Indica tu nombre"),
      email: z.string().email("Email no válido").optional(),
      phone: z.string().min(6, "Teléfono no válido").max(40).optional(),
      startIso: z.string().datetime({ message: "Fecha no válida" }),
      durationMin: z.coerce.number().int().min(15).max(480).default(60),
      partySize: z.coerce.number().int().min(1).max(100).optional(),
      notes: z.string().trim().max(1000).optional(),
      website: z.string().optional(), // honeypot: debe ir vacío
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos no válidos" });
  }
  const data = parsed.data;

  // Honeypot: si un bot rellenó el campo oculto, fingir éxito sin crear nada.
  if (data.website && data.website.length > 0) {
    return res.json({ ok: true });
  }

  const agent = await prisma.agent.findUnique({ where: { publicKey: data.publicKey } });
  if (!agent) return res.status(404).json({ error: "Negocio no encontrado" });

  const start = new Date(data.startIso);
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
    return res.status(400).json({ error: "La fecha debe ser futura" });
  }
  const end = new Date(start.getTime() + data.durationMin * 60_000);

  let token: string;
  try {
    token = await getValidToken(agent.id, "google");
  } catch {
    return res.status(409).json({ error: "El negocio aún no tiene Google Calendar conectado" });
  }

  try {
    const title = `Reserva: ${data.name}${data.partySize ? ` (${data.partySize} pax)` : ""}`;
    const description = [
      data.phone && `Tel: ${data.phone}`,
      data.email && `Email: ${data.email}`,
      data.notes,
    ]
      .filter(Boolean)
      .join("\n");
    const event = await createEvent(token, {
      title,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      description: description || undefined,
      attendees: data.email ? [data.email] : undefined,
    });
    res.status(201).json({ ok: true, eventId: event.id });
  } catch (e) {
    console.error("[reserve] createEvent:", e);
    res.status(502).json({ error: "No se pudo crear la reserva en el calendario" });
  }
});
