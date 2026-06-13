import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { nextContactCode, withCodeRetry } from "@/lib/codes";

/**
 * Agenda de contactos comerciales (leads / prospectos).
 * Código de negocio pc-NN autogenerado y secuencial.
 */

export const contactsRouter = Router();

const CONTACT_TYPES = ["lead", "prospecto"] as const;
const CONTACTED_VALUES = ["si", "no", "nc"] as const;

export const createContactSchema = z.object({
  type: z.enum(CONTACT_TYPES).default("prospecto"),
  name: z.string().trim().min(1, "El nombre es obligatorio"),
  phone: z.string().trim().min(1).optional(),
  email: z.string().trim().email("Email no válido").optional(),
  sector: z.string().trim().optional(),
  direccion: z.string().trim().optional(),
  contactado: z.enum(CONTACTED_VALUES).optional(),
  clientId: z.string().optional(),
});

/** Default de contactado según el tipo: lead → "no" (aún sin llamar), prospecto → "nc". */
export function defaultContactado(
  type: (typeof CONTACT_TYPES)[number],
  explicit?: (typeof CONTACTED_VALUES)[number]
): (typeof CONTACTED_VALUES)[number] {
  if (explicit) return explicit;
  return type === "lead" ? "no" : "nc";
}

export const updateContactSchema = z.object({
  type: z.enum(CONTACT_TYPES).optional(),
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().email("Email no válido").nullable().optional(),
  sector: z.string().trim().nullable().optional(),
  direccion: z.string().trim().nullable().optional(),
  contactado: z.enum(CONTACTED_VALUES).optional(),
  clientId: z.string().nullable().optional(),
});

export const listContactsQuerySchema = z.object({
  type: z.enum(CONTACT_TYPES).optional(),
  contactado: z.enum(CONTACTED_VALUES).optional(),
});

/** Construye el where de listado a partir de la query (función pura, testeable). */
export function buildContactsWhere(query: z.infer<typeof listContactsQuerySchema>) {
  const where: Record<string, unknown> = {};
  if (query.type) where.type = query.type;
  if (query.contactado) where.contactado = query.contactado;
  return where;
}

/**
 * Calcula el patch de contactedAt según el cambio de estado:
 *  - pasa a "si" → sella la fecha (solo si no estaba ya sellada)
 *  - pasa a "no"/"nc" → limpia la fecha
 *  - sin cambio de contactado → no toca contactedAt
 */
export function contactedAtPatch(
  newStatus: (typeof CONTACTED_VALUES)[number] | undefined,
  current: { contactado: string; contactedAt: Date | null },
  now: Date = new Date()
): { contactedAt?: Date | null } {
  if (newStatus === undefined) return {};
  if (newStatus === "si") {
    return current.contactedAt ? {} : { contactedAt: now };
  }
  return { contactedAt: null };
}

/* ---------- Handlers (exportados para tests) ---------- */

export async function listContactsHandler(req: Request, res: Response) {
  const parsed = listContactsQuerySchema.safeParse({
    type: req.query.type || undefined,
    contactado: req.query.contactado || undefined,
  });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const contacts = await prisma.prospectContact.findMany({
      where: buildContactsWhere(parsed.data),
      orderBy: { createdAt: "desc" },
      include: { client: { select: { id: true, name: true, codCliente: true } } },
    });
    res.json(contacts);
  } catch {
    res.status(500).json({ error: "No se pudieron cargar los contactos" });
  }
}

export async function pendingCountHandler(_req: Request, res: Response) {
  try {
    const count = await prisma.prospectContact.count({
      where: { contactado: { not: "si" } },
    });
    res.json({ count });
  } catch {
    res.status(500).json({ error: "No se pudo calcular el contador" });
  }
}

export async function createContactHandler(req: Request, res: Response) {
  const parsed = createContactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = parsed.data;
  const contactado = defaultContactado(data.type, data.contactado);
  try {
    const contact = await withCodeRetry(async () =>
      prisma.prospectContact.create({
        data: {
          codigo: await nextContactCode(),
          type: data.type,
          name: data.name,
          phone: data.phone ?? null,
          email: data.email ?? null,
          sector: data.sector ?? null,
          direccion: data.direccion ?? null,
          contactado,
          contactedAt: contactado === "si" ? new Date() : null,
          clientId: data.clientId ?? null,
        },
      })
    );
    res.status(201).json(contact);
  } catch (e: any) {
    if (e?.code === "P2003") {
      return res.status(400).json({ error: "El cliente vinculado no existe" });
    }
    res.status(500).json({ error: "No se pudo crear el contacto" });
  }
}

export async function updateContactHandler(req: Request, res: Response) {
  const parsed = updateContactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const current = await prisma.prospectContact.findUnique({
      where: { id: req.params.id },
      select: { contactado: true, contactedAt: true },
    });
    if (!current) return res.status(404).json({ error: "Contacto no encontrado" });

    const data = parsed.data;
    const contact = await prisma.prospectContact.update({
      where: { id: req.params.id },
      data: {
        ...(data.type !== undefined && { type: data.type }),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.sector !== undefined && { sector: data.sector }),
        ...(data.direccion !== undefined && { direccion: data.direccion }),
        ...(data.contactado !== undefined && { contactado: data.contactado }),
        ...(data.clientId !== undefined && { clientId: data.clientId }),
        ...contactedAtPatch(data.contactado, current),
      },
    });
    res.json(contact);
  } catch (e: any) {
    if (e?.code === "P2003") {
      return res.status(400).json({ error: "El cliente vinculado no existe" });
    }
    res.status(500).json({ error: "No se pudo actualizar el contacto" });
  }
}

export async function deleteContactHandler(req: Request, res: Response) {
  try {
    await prisma.prospectContact.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e: any) {
    if (e?.code === "P2025") {
      return res.status(404).json({ error: "Contacto no encontrado" });
    }
    res.status(500).json({ error: "No se pudo eliminar el contacto" });
  }
}

/* ---------- Rutas ---------- */

// pending-count antes que rutas con :id para evitar colisiones
contactsRouter.get("/pending-count", pendingCountHandler);
contactsRouter.get("/", listContactsHandler);
contactsRouter.post("/", createContactHandler);
contactsRouter.patch("/:id", updateContactHandler);
contactsRouter.delete("/:id", deleteContactHandler);
