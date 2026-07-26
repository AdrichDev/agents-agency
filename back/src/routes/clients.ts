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
    const clients = await prisma.tenant.findMany({
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
    const client = await prisma.tenant.findUnique({
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
  nif: optionalText,
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
      prisma.tenant.create({
        data: {
          codigo: await nextClientCode(),
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
      const client = await prisma.tenant.update({
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

/* ---------- Créditos de IA (tokens) ---------- */

// H4 (T6.4): los dos campos son opcionales, y cada uno sólo se escribe si viene. Antes
// `tokenBalance` era obligatorio, y eso dejaba el kill switch manual inoperable desde el panel:
// `TokenSwitch` manda sólo `{isActive}` y recibía 400. Con T1 ese switch es la ÚNICA forma de
// suspender o reactivar a un cliente, así que tenía que dejar de fallar.
const creditsSchema = z
  .object({
    // Cupo absoluto de tokens a asignar (recarga = fijar un nuevo total). Si se omite, NO se toca.
    tokenBalance: z.number().int().min(0).optional(),
    // Activar/desactivar manualmente. Si se omite, NO se toca.
    isActive: z.boolean().optional(),
  })
  .refine((b) => b.tokenBalance !== undefined || b.isActive !== undefined, {
    message: "Indica al menos tokenBalance o isActive",
  });

clientsRouter.patch(
  "/:id/credits",
  validate.body(creditsSchema),
  asyncHandler(async (req, res) => {
    const { tokenBalance, isActive } = req.validatedBody as z.infer<typeof creditsSchema>;
    const current = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!current) throw new HttpError(404, "Cliente no encontrado");
    // H4 (aa-planes-y-cuotas, T1.2): `isActive` sólo cambia si viene explícito. Antes se
    // derivaba del cupo (`isActive ?? tokenBalance > tokensUsed`), y eso mezclaba cupo con
    // estado de pago en las dos direcciones: recargar crédito reactivaba a un cliente
    // suspendido por impago, y bajarle el cupo suspendía a uno que estaba al día. El bloqueo
    // por cupo no necesita este booleano: lo aplica `checkClientBalance` comparando saldo.
    const client = await prisma.tenant.update({
      where: { id: req.params.id },
      data: {
        ...(tokenBalance !== undefined && { tokenBalance }),
        ...(isActive !== undefined && { isActive }),
      },
      select: { id: true, tokenBalance: true, tokensUsed: true, isActive: true },
    });
    res.json(client);
  })
);

clientsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      await prisma.tenant.delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch (e: any) {
      if (e?.code === "P2025") throw new HttpError(404, "Cliente no encontrado");
      throw e;
    }
  })
);
