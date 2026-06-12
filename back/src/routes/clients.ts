import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { nextClientCode, withCodeRetry } from "@/lib/codes";

/* ---------- Clientes ---------- */

export const clientsRouter = Router();

clientsRouter.get("/", async (_req, res) => {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { budgets: true, agents: true } } },
    });
    // hasInvoices: la facturación se apoya en Budget — tiene facturas si tiene presupuestos
    res.json(clients.map((c) => ({ ...c, hasInvoices: c._count.budgets > 0 })));
  } catch {
    res.status(500).json({ error: "No se pudieron cargar los clientes" });
  }
});

clientsRouter.get("/:id", async (req, res) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: { budgets: { orderBy: { createdAt: "desc" } } },
    });
    if (!client) return res.status(404).json({ error: "Cliente no encontrado" });
    res.json({ ...client, hasInvoices: client.budgets.length > 0 });
  } catch {
    res.status(500).json({ error: "Error al obtener el cliente" });
  }
});

const optionalText = z.string().trim().nullable().optional();
const clientCreateSchema = z.object({
  name: z.string().trim().min(1, "El campo 'name' es obligatorio"),
  razonSocial: optionalText,
  cif: optionalText,
  address: optionalText,
  direccion: optionalText,
  email: z.string().trim().email("Email no válido").nullable().optional().or(z.literal("")),
  phone: optionalText,
  contactPerson: optionalText,
  website: optionalText,
  sector: optionalText,
});
const clientUpdateSchema = clientCreateSchema.partial();

clientsRouter.post("/", async (req, res) => {
  const parsed = clientCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const data = parsed.data;
    // codCliente autogenerado (cli-NN secuencial); reintento si otra petición gana la carrera
    const client = await withCodeRetry(async () =>
      prisma.client.create({
        data: {
          codCliente: await nextClientCode(),
          ...data,
        },
      })
    );
    res.status(201).json(client);
  } catch {
    res.status(500).json({ error: "No se pudo crear el cliente" });
  }
});

clientsRouter.put("/:id", async (req, res) => {
  const parsed = clientUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json(client);
  } catch {
    res.status(500).json({ error: "No se pudo actualizar el cliente" });
  }
});

clientsRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.client.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "No se pudo eliminar el cliente" });
  }
});
