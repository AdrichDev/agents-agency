/**
 * Funciones de facturas: número visible, métricas agregadas y el alta idempotente
 * de la factura de un presupuesto.
 * Igual que computeBudgetTotals: los importes NUNCA se confían al cliente,
 * se derivan siempre de datos persistidos (totales del presupuesto asociado).
 */

import type { Prisma } from "@/lib/generated/prisma/client";

/** Redondea a 2 decimales evitando errores de coma flotante. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Deriva el número visible de factura a partir del número de presupuesto.
 * "AD-2026-001" → "FAC - 2026-001". Estable e idempotente: la misma
 * quoteNumber siempre produce el mismo number de factura (sin secuencia
 * propia, sin condición de carrera).
 */
export function deriveInvoiceNumber(quoteNumber: string): string {
  const stripped = quoteNumber.replace(/^AD-/, "");
  return `FAC - ${stripped}`;
}

export type InvoiceStatus = "pendiente" | "cobrada";

export interface InvoiceForMetrics {
  status: string;
  totalImpl: number;
  totalMaint: number;
}

export interface InvoiceMetrics {
  totalCount: number;
  pendingCount: number;
  paidCount: number;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
}

/**
 * Calcula contadores e importes agregados a partir de facturas persistidas
 * (status + totales del presupuesto asociado, ya calculados server-side).
 */
export function computeInvoiceMetrics(invoices: InvoiceForMetrics[]): InvoiceMetrics {
  let totalAmount = 0;
  let paidAmount = 0;
  let pendingCount = 0;
  let paidCount = 0;

  for (const inv of invoices) {
    const amount = (inv.totalImpl ?? 0) + (inv.totalMaint ?? 0);
    totalAmount += amount;
    if (inv.status === "cobrada") {
      paidAmount += amount;
      paidCount += 1;
    } else {
      pendingCount += 1;
    }
  }

  return {
    totalCount: invoices.length,
    pendingCount,
    paidCount,
    totalAmount: round2(totalAmount),
    paidAmount: round2(paidAmount),
    pendingAmount: round2(totalAmount - paidAmount),
  };
}

/* ---------- Alta de la factura de un presupuesto aceptado ---------- */

// Columnas @unique de Invoice (ver schema.prisma): budgetId (mapeada a presupuesto_id)
// garantiza idempotencia 1 presupuesto = 1 factura; number (mapeada a numero_factura) es
// el número visible derivado de quoteNumber. Un P2002 puede venir de cualquiera de las
// dos — Prisma popula err.meta.target con la(s) columna(s) real(es) en conflicto.
const INVOICE_BUDGET_UNIQUE_TARGETS = ["budgetId", "presupuesto_id"];
const INVOICE_NUMBER_UNIQUE_TARGETS = ["number", "numero_factura"];

function tieneTargetDe(err: any, columnas: readonly string[]): boolean {
  const target = err?.meta?.target;
  if (!target) return false;
  const nombres = Array.isArray(target) ? target : [target];
  return nombres.some((c: unknown) => columnas.includes(c as string));
}

/** ¿El P2002 es por la factura ya existente de este presupuesto? */
export function isBudgetUniqueConflict(err: any): boolean {
  return err?.code === "P2002" && tieneTargetDe(err, INVOICE_BUDGET_UNIQUE_TARGETS);
}

/** ¿El P2002 es una colisión del número visible de factura? */
export function isInvoiceNumberConflict(err: any): boolean {
  return err?.code === "P2002" && tieneTargetDe(err, INVOICE_NUMBER_UNIQUE_TARGETS);
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
 *
 * La usan el panel (PUT /api/budgets/:id/status) y el operador
 * (agencia_crear_factura): una sola definición del nacimiento de una factura.
 */
export async function ensureInvoiceForBudget(
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
    if (isBudgetUniqueConflict(err)) return; // ya existe factura para este presupuesto
    throw err;
  }
}
