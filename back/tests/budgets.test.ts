import { describe, it, expect } from "vitest";
import { computeBudgetTotals } from "@/lib/budgets";

describe("computeBudgetTotals", () => {
  it("suma cantidad * precio por línea (subtotales sin IVA)", () => {
    const totals = computeBudgetTotals(
      [
        { quantity: 2, implPrice: 100, maintPrice: 10 },
        { quantity: 1, implPrice: 50, maintPrice: 5 },
      ],
      0.21
    );
    expect(totals.subtotalImpl).toBe(250); // 2*100 + 1*50
    expect(totals.subtotalMaint).toBe(25); // 2*10 + 1*5
  });

  it("aplica IVA a los totales", () => {
    const totals = computeBudgetTotals([{ quantity: 1, implPrice: 100, maintPrice: 0 }], 0.21);
    expect(totals.totalImpl).toBe(121);
    expect(totals.totalMaint).toBe(0);
  });

  it("ignora totales enviados por el cliente (solo usa líneas)", () => {
    // El cálculo no acepta totales externos: si las líneas suman 100, el total es 100*IVA.
    const totals = computeBudgetTotals([{ quantity: 1, implPrice: 100 }], 0);
    expect(totals.totalImpl).toBe(100);
  });

  it("usa quantity=1 por defecto y precios=0 ausentes", () => {
    const totals = computeBudgetTotals([{ implPrice: 30 }, {}], 0);
    expect(totals.subtotalImpl).toBe(30);
    expect(totals.subtotalMaint).toBe(0);
  });

  it("redondea a 2 decimales", () => {
    const totals = computeBudgetTotals([{ quantity: 3, implPrice: 33.33 }], 0.21);
    expect(totals.subtotalImpl).toBe(99.99);
    expect(totals.totalImpl).toBe(120.99); // 99.99 * 1.21 = 120.9879 → 120.99
  });
});
