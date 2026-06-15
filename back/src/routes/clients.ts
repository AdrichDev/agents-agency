import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { nextClientCode, withCodeRetry } from "@/lib/codes";
import { asyncHandler, validate, HttpError } from "@/lib/http";

/* ---------- Clientes ---------- */
// Router de referencia del patrón "API foundations": asyncHandler + validate + HttpError.
// Los errores los formatea el errorHandler central (envelope consistente).

export const clientsRouter = Router();

clientsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const clients = await prisma.client.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { budgets: true, agents: true } } },
    });
    // hasInvoices: la facturación se apoya en Budget — tiene facturas si tiene presupuestos
    res.json(clients.map((c) => ({ ...c, hasInvoices: c._count.budgets > 0 })));
  })
);

clientsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: { budgets: { orderBy: { createdAt: "desc" } } },
    });
    if (!client) throw new HttpError(404, "Cliente no encontrado");
    res.json({ ...client, hasInvoices: client.budgets.length > 0 });
  })
);

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

clientsRouter.post(
  "/",
  validate.body(clientCreateSchema),
  asyncHandler(async (req, res) => {
    const data = req.validatedBody as z.infer<typeof clientCreateSchema>;
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
  })
);

clientsRouter.put(
  "/:id",
  validate.body(clientUpdateSchema),
  asyncHandler(async (req, res) => {
    const data = req.validatedBody as z.infer<typeof clientUpdateSchema>;
    try {
      const client = await prisma.client.update({
        where: { id: req.params.id },
        data,
      });
      res.json(client);
    } catch (e: any) {
      if (e?.code === "P2025") throw new HttpError(404, "Cliente no encontrado");
      throw e;
    }
  })
);

clientsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      await prisma.client.delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch (e: any) {
      if (e?.code === "P2025") throw new HttpError(404, "Cliente no encontrado");
      throw e;
    }
  })
);
