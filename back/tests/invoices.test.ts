import { describe, it, expect } from "vitest";
import { deriveInvoiceNumber, computeInvoiceMetrics } from "@/lib/invoices";

describe("deriveInvoiceNumber", () => {
  it("sustituye el prefijo AD- por 'FAC - '", () => {
    expect(deriveInvoiceNumber("AD-2026-001")).toBe("FAC - 2026-001");
  });

  it("es estable: la misma quoteNumber siempre produce el mismo número", () => {
    const a = deriveInvoiceNumber("AD-2026-042");
    const b = deriveInvoiceNumber("AD-2026-042");
    expect(a).toBe(b);
  });

  it("si no hay prefijo AD- conocido, antepone 'FAC - ' igualmente", () => {
    expect(deriveInvoiceNumber("XYZ-001")).toBe("FAC - XYZ-001");
  });
});

describe("computeInvoiceMetrics", () => {
  it("cuenta facturas pendientes y cobradas por separado", () => {
    const metrics = computeInvoiceMetrics([
      { status: "pendiente", totalImpl: 100, totalMaint: 0 },
      { status: "cobrada", totalImpl: 200, totalMaint: 0 },
      { status: "pendiente", totalImpl: 50, totalMaint: 0 },
    ]);
    expect(metrics.totalCount).toBe(3);
    expect(metrics.pendingCount).toBe(2);
    expect(metrics.paidCount).toBe(1);
  });

  it("suma importes totales, cobrados y pendientes (impl + maint)", () => {
    const metrics = computeInvoiceMetrics([
      { status: "pendiente", totalImpl: 100, totalMaint: 10 },
      { status: "cobrada", totalImpl: 200, totalMaint: 20 },
    ]);
    expect(metrics.totalAmount).toBe(330); // 110 + 220
    expect(metrics.paidAmount).toBe(220);
    expect(metrics.pendingAmount).toBe(110);
  });

  it("devuelve ceros con una lista vacía (sin facturas)", () => {
    const metrics = computeInvoiceMetrics([]);
    expect(metrics).toEqual({
      totalCount: 0,
      pendingCount: 0,
      paidCount: 0,
      totalAmount: 0,
      paidAmount: 0,
      pendingAmount: 0,
    });
  });

  it("redondea a 2 decimales", () => {
    const metrics = computeInvoiceMetrics([{ status: "pendiente", totalImpl: 33.333, totalMaint: 0 }]);
    expect(metrics.totalAmount).toBe(33.33);
  });
});
