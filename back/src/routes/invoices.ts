import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { computeInvoiceMetrics } from "@/lib/invoices";
import { asyncHandler, validate, HttpError } from "@/lib/http";

/* ---------- Facturas ----------
 * Nacen automáticamente al aceptar un presupuesto (ver routes/budgets.ts,
 * ensureInvoiceForBudget). No existe creación manual — este router solo
 * lista, muestra y permite marcar el cobro.
 */

export const invoicesRouter = Router();

const invoiceInclude = {
  budget: {
    include: {
      tenant: { select: { id: true, name: true, nif: true } },
      lines: { orderBy: { position: "asc" as const } },
    },
  },
} as const;

invoicesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const invoices = await prisma.invoice.findMany({
      orderBy: { createdAt: "desc" },
      include: invoiceInclude,
    });
    const metrics = computeInvoiceMetrics(
      invoices.map((i) => ({
        status: i.status,
        totalImpl: i.budget.totalImpl,
        totalMaint: i.budget.totalMaint,
      }))
    );
    res.json({ invoices, metrics });
  })
);

invoicesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: invoiceInclude,
    });
    if (!invoice) throw new HttpError(404, "Factura no encontrada");
    res.json(invoice);
  })
);

const INVOICE_STATUSES = ["pendiente", "cobrada"] as const;
const invoiceStatusSchema = z.object({ status: z.enum(INVOICE_STATUSES) });

invoicesRouter.put(
  "/:id/status",
  validate.body(invoiceStatusSchema),
  asyncHandler(async (req, res) => {
    const { status } = req.validatedBody as z.infer<typeof invoiceStatusSchema>;
    try {
      const invoice = await prisma.invoice.update({
        where: { id: req.params.id },
        data: { status, paidAt: status === "cobrada" ? new Date() : null },
      });
      res.json(invoice);
    } catch (err: any) {
      if (err?.code === "P2025") throw new HttpError(404, "Factura no encontrada");
      throw err;
    }
  })
);
