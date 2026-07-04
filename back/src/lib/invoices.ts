/**
 * Funciones puras de facturas (número visible y métricas agregadas).
 * Igual que computeBudgetTotals: los importes NUNCA se confían al cliente,
 * se derivan siempre de datos persistidos (totales del presupuesto asociado).
 */

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
