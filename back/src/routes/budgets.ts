import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { computeBudgetTotals } from "@/lib/budgets";
import { deriveInvoiceNumber } from "@/lib/invoices";
import { asyncHandler, validate, HttpError } from "@/lib/http";

/* ---------- Presupuestos ---------- */

export const budgetsRouter = Router();

budgetsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const budgets = await prisma.budget.findMany({
      orderBy: { createdAt: "desc" },
      include: { tenant: { select: { id: true, name: true, nif: true } }, lines: true },
    });
    res.json(budgets);
  })
);

budgetsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const budget = await prisma.budget.findUnique({
      where: { id: req.params.id },
      include: { tenant: true, lines: { orderBy: { position: "asc" } } },
    });
    if (!budget) throw new HttpError(404, "Presupuesto no encontrado");
    res.json(budget);
  })
);

const budgetLineSchema = z.object({
  serviceId: z.string().default(""),
  name: z.string().default(""),
  description: z.string().nullable().optional(),
  quantity: z.number().nonnegative().default(1),
  implPrice: z.number().nonnegative().default(0),
  maintPrice: z.number().nonnegative().default(0),
});

const budgetCreateSchema = z.object({
  quoteNumber: z.string().min(1, "El campo 'quoteNumber' es obligatorio"),
  clientId: z.string().nullable().optional(),
  clientSnapshot: z.record(z.unknown()).optional(),
  issuerSnapshot: z.record(z.unknown()).optional(),
  status: z.string().optional(),
  vatRate: z.number().min(0).max(1).default(0.21),
  validDays: z.number().int().positive().default(30),
  notes: z.string().nullable().optional(),
  lines: z.array(budgetLineSchema).default([]),
});

budgetsRouter.post(
  "/",
  validate.body(budgetCreateSchema),
  asyncHandler(async (req, res) => {
    const {
      quoteNumber, clientId, clientSnapshot, issuerSnapshot,
      status, vatRate, validDays, notes, lines,
    } = req.validatedBody as z.infer<typeof budgetCreateSchema>;

    // Totales SIEMPRE server-side a partir de las líneas (no se confían al cliente).
    const totals = computeBudgetTotals(lines, vatRate);

    try {
      const budget = await prisma.budget.create({
        data: {
          quoteNumber,
          tenantId: clientId || undefined,
          clientSnapshot: (clientSnapshot ?? {}) as any,
          issuerSnapshot: (issuerSnapshot ?? {}) as any,
          status: status ?? "draft",
          subtotalImpl: totals.subtotalImpl,
          subtotalMaint: totals.subtotalMaint,
          totalImpl: totals.totalImpl,
          totalMaint: totals.totalMaint,
          vatRate,
          validDays,
          notes,
          lines: {
            create: lines.map((l, i: number) => ({
              serviceId: l.serviceId,
              name: l.name,
              description: l.description ?? undefined,
              quantity: l.quantity ?? 1,
              implPrice: l.implPrice ?? 0,
              maintPrice: l.maintPrice ?? 0,
              position: i,
            })),
          },
        },
        include: { lines: true },
      });
      res.status(201).json(budget);
    } catch (err: any) {
      if (err?.code === "P2002") throw new HttpError(409, "Ya existe un presupuesto con ese número");
      throw err;
    }
  })
);

// Vocabulario cerrado de estados (igual que el ciclo de estados del front en BudgetList).
const BUDGET_STATUSES = ["generada", "aceptada", "rechazada", "caducada"] as const;
const budgetStatusSchema = z.object({ status: z.enum(BUDGET_STATUSES) });

// Columnas @unique de Invoice (ver schema.prisma): budgetId (mapeada a presupuesto_id)
// garantiza idempotencia 1 presupuesto = 1 factura; number (mapeada a numero_factura) es
// el número visible derivado de quoteNumber. Un P2002 puede venir de cualquiera de las
// dos — Prisma popula err.meta.target con la(s) columna(s) real(es) en conflicto.
const INVOICE_BUDGET_UNIQUE_TARGETS = ["budgetId", "presupuesto_id"];

function isBudgetUniqueConflict(err: any): boolean {
  const target = err?.meta?.target;
  if (!target) return false;
  const columns = Array.isArray(target) ? target : [target];
  return columns.some((c: unknown) => INVOICE_BUDGET_UNIQUE_TARGETS.includes(c as string));
}

/**
 * Crea la factura asociada a un presupuesto aceptado, de forma idempotente:
 * budgetId es @unique en Invoice, así que un reproceso del evento de aceptación
 * (doble clic, reintento, webhook duplicado) choca con P2002 en la columna
 * budgetId/presupuesto_id y se ignora en vez de crear una segunda factura.
 * Invoice.number TAMBIÉN es @unique: si el P2002 viene de esa columna (colisión de
 * deriveInvoiceNumber entre dos presupuestos con quoteNumber distintos que normalizan
 * igual), NO se debe tragar el error — eso sería una pérdida silenciosa de factura con
 * respuesta 200 como si nada hubiera pasado. Se relanza para que el fallo sea visible.
 */
async function ensureInvoiceForBudget(
  tx: Prisma.TransactionClient,
  budget: { id: string; quoteNumber: string }
): Promise<void> {
  try {
    await tx.invoice.create({
      data: {
        number: deriveInvoiceNumber(budget.quoteNumber),
        budgetId: budget.id,
        status: "pendiente",
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002" && isBudgetUniqueConflict(err)) return; // ya existe factura para este presupuesto
    throw err;
  }
}

budgetsRouter.put(
  "/:id/status",
  validate.body(budgetStatusSchema),
  asyncHandler(async (req, res) => {
    const { status } = req.validatedBody as z.infer<typeof budgetStatusSchema>;
    try {
      const budget = await prisma.$transaction(async (tx) => {
        const current = await tx.budget.findUnique({
          where: { id: req.params.id },
          include: { invoice: true },
        });
        if (!current) throw new HttpError(404, "Presupuesto no encontrado");
        // No se puede abandonar 'aceptada' si ya existe una factura vinculada: el
        // Invoice tiene onDelete: Restrict y nada reconcilia la factura huérfana.
        if (current.status === "aceptada" && status !== "aceptada" && current.invoice) {
          throw new HttpError(
            400,
            "No se puede cambiar el estado: el presupuesto ya tiene una factura asociada"
          );
        }

        const updated = await tx.budget.update({
          where: { id: req.params.id },
          data: { status },
        });
        if (status === "aceptada") {
          await ensureInvoiceForBudget(tx, updated);
        }
        return updated;
      });
      res.json(budget);
    } catch (err: any) {
      if (err instanceof HttpError) throw err;
      if (err?.code === "P2025") throw new HttpError(404, "Presupuesto no encontrado");
      throw err;
    }
  })
);
