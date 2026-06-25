import { test, expect } from "@playwright/test";

// Tests for the "Mi Cuenta" feature (aa-perfil-editable).
// These are structural/navigation tests that do not require an authenticated session.
// Authentication-gated form tests would require valid Supabase credentials (integration).

test.describe("Mi Cuenta — estructura y navegación", () => {
  test("la ruta /cuenta existe y carga sin error 404", async ({ page }) => {
    // The page redirects to landing if not authenticated — that is expected behaviour.
    // We just verify it does not 404 (Next.js route exists).
    const response = await page.goto("/cuenta");
    // Accept 200 (unauthenticated redirect to '/') or the page itself loading.
    // A 404 would indicate the route was not created.
    expect(response?.status()).not.toBe(404);
  });

  test("la landing no muestra errores al cargar", async ({ page }) => {
    await page.goto("/");
    // No JS errors that would prevent navigation.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
