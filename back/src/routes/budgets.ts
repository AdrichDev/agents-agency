import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { computeBudgetTotals } from "@/lib/budgets";

/* ---------- Presupuestos ---------- */

export const budgetsRouter = Router();

budgetsRouter.get("/", async (_req, res) => {
  try {
    const budgets = await prisma.budget.findMany({
      orderBy: { createdAt: "desc" },
      include: { client: { select: { id: true, name: true, cif: true } }, lines: true },
    });
    res.json(budgets);
  } catch {
    res.status(500).json({ error: "No se pudieron cargar los presupuestos" });
  }
});

budgetsRouter.get("/:id", async (req, res) => {
  try {
    const budget = await prisma.budget.findUnique({
      where: { id: req.params.id },
      include: { client: true, lines: { orderBy: { position: "asc" } } },
    });
    if (!budget) return res.status(404).json({ error: "Presupuesto no encontrado" });
    res.json(budget);
  } catch {
    res.status(500).json({ error: "Error al obtener el presupuesto" });
  }
});

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

budgetsRouter.post("/", async (req, res) => {
  const parsed = budgetCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const {
      quoteNumber, clientId, clientSnapshot, issuerSnapshot,
      status, vatRate, validDays, notes, lines,
    } = parsed.data;

    // Totales SIEMPRE server-side a partir de las líneas (no se confían al cliente).
    const totals = computeBudgetTotals(lines, vatRate);

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
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "Ya existe un presupuesto con ese número" });
    }
    res.status(500).json({ error: "No se pudo crear el presupuesto" });
  }
});

budgetsRouter.put("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const budget = await prisma.budget.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json(budget);
  } catch {
    res.status(500).json({ error: "No se pudo actualizar el estado" });
  }
});
