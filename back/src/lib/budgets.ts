/**
 * Cálculo server-side de totales de presupuesto.
 * Los totales NUNCA se confían al cliente: se computan a partir de las líneas.
 */

export interface BudgetLineInput {
  quantity?: number;
  implPrice?: number;
  maintPrice?: number;
}

export interface BudgetTotals {
  subtotalImpl: number;
  subtotalMaint: number;
  totalImpl: number;
  totalMaint: number;
}

/** Redondea a 2 decimales evitando errores de coma flotante. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula subtotales (sin IVA) y totales (con IVA) a partir de las líneas.
 * vatRate es una fracción (p. ej. 0.21 para 21%).
 */
export function computeBudgetTotals(
  lines: BudgetLineInput[],
  vatRate: number
): BudgetTotals {
  let subtotalImpl = 0;
  let subtotalMaint = 0;

  for (const l of lines) {
    const qty = Number.isFinite(l.quantity) ? Number(l.quantity) : 1;
    const impl = Number.isFinite(l.implPrice) ? Number(l.implPrice) : 0;
    const maint = Number.isFinite(l.maintPrice) ? Number(l.maintPrice) : 0;
    subtotalImpl += qty * impl;
    subtotalMaint += qty * maint;
  }

  const rate = Number.isFinite(vatRate) ? vatRate : 0;

  return {
    subtotalImpl: round2(subtotalImpl),
    subtotalMaint: round2(subtotalMaint),
    totalImpl: round2(subtotalImpl * (1 + rate)),
    totalMaint: round2(subtotalMaint * (1 + rate)),
  };
}
