import { test, expect } from "@playwright/test";

// e2e del fix aa-bug-generar-prompt-redirect (interceptor 401 de lib/api.ts).
// Ante un 401 del back, el interceptor ya NO redirige a "/" pelado perdiendo el
// contexto; ahora va a "/?returnTo=<ruta>" para que el login devuelva al usuario.
// No necesita backend real: la respuesta 401 se mockea con page.route.

test.describe("Interceptor 401 → returnTo", () => {
  test("un 401 en una ruta protegida redirige a /?returnTo=<ruta original>", async ({ page }) => {
    // Cualquier llamada a la API del back responde 401 (sesión ausente/caducada).
    await page.route("**/api/**", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "No autenticado" }),
      }),
    );

    await page.goto("/landing-builder/test-id");

    // Redirige a la landing conservando la ruta original codificada en returnTo.
    await expect(page).toHaveURL(/returnTo=%2Flanding-builder%2Ftest-id/, { timeout: 15000 });
  });

  test("un 401 estando ya en la landing NO entra en bucle de redirección", async ({ page }) => {
    await page.route("**/api/**", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "No autenticado" }),
      }),
    );

    await page.goto("/");
    // En "/" el interceptor no vuelve a redirigir (onLanding), no hay returnTo ni bucle.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
  });
});
