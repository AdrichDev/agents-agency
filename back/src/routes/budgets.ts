import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { computeBudgetTotals } from "@/lib/budgets";
import { asyncHandler, validate, HttpError } from "@/lib/http";

/* ---------- Presupuestos ---------- */

export const budgetsRouter = Router();

budgetsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const budgets = await prisma.budget.findMany({
      orderBy: { createdAt: "desc" },
      include: { client: { select: { id: true, name: true, cif: true } }, lines: true },
    });
    res.json(budgets);
  })
);

budgetsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const budget = await prisma.budget.findUnique({
      where: { id: req.params.id },
      include: { client: true, lines: { orderBy: { position: "asc" } } },
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
          clientId: clientId || undefined,
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

const budgetStatusSchema = z.object({ status: z.string().trim().min(1) });

budgetsRouter.put(
  "/:id/status",
  validate.body(budgetStatusSchema),
  asyncHandler(async (req, res) => {
    const { status } = req.validatedBody as z.infer<typeof budgetStatusSchema>;
    try {
      const budget = await prisma.budget.update({
        where: { id: req.params.id },
        data: { status },
      });
      res.json(budget);
    } catch (err: any) {
      if (err?.code === "P2025") throw new HttpError(404, "Presupuesto no encontrado");
      throw err;
    }
  })
);
