import { test, expect } from "@playwright/test";

// Structural tests for the "Facturas" screen (aa-facturas-desde-presupuestos-aceptados).
// No manual creation exists for invoices, so these checks do not require an
// authenticated session — same pattern as cuenta.spec.ts.

test.describe("Facturas — estructura y navegación", () => {
  test("la ruta /facturas existe y carga sin error 404", async ({ page }) => {
    const response = await page.goto("/facturas");
    expect(response?.status()).not.toBe(404);
  });
});
