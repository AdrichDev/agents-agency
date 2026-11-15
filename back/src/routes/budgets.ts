import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { buildBudgetCreateData } from "@/lib/budgets";
import { ensureInvoiceForBudget } from "@/lib/invoices";
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
  clientSnapshot: z.record(z.string(), z.unknown()).optional(),
  issuerSnapshot: z.record(z.string(), z.unknown()).optional(),
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

    try {
      // Totales SIEMPRE server-side a partir de las líneas (no se confían al cliente),
      // más líneas y snapshots: el builder compartido es el ÚNICO shape que se persiste
      // (lo reutiliza también el operador en agencia_crear_factura, S17).
      const budget = await prisma.budget.create({
        data: buildBudgetCreateData({
          quoteNumber,
          clientId,
          clientSnapshot,
          issuerSnapshot,
          status,
          vatRate,
          validDays,
          notes,
          lines,
        }),
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
