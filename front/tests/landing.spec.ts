import { test, expect } from "@playwright/test";

// e2e del flujo público de la landing + login. No necesita back ni credenciales
// válidas: ejercita LandingHeader (gate del botón por !user) y LoginModal
// (signInWithPassword → error), verificando que un login fallido NO redirige ni
// entra en bucle (la regresión histórica que arreglamos).

test.describe("Landing + login", () => {
  test("la landing carga y muestra el botón de iniciar sesión", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
    // Hero presente (la página renderiza, no es un error).
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("abre el modal de login con sus campos", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    const modal = page.getByTestId("login-modal");
    await expect(modal.getByPlaceholder("Email")).toBeVisible();
    await expect(modal.getByPlaceholder("Contraseña")).toBeVisible();
    await expect(modal.getByRole("button", { name: /Entrar/ })).toBeVisible();
  });

  test("login inválido: muestra error y NO redirige (sin bucle)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    const modal = page.getByTestId("login-modal");
    await modal.getByPlaceholder("Email").fill("nadie@example.com");
    await modal.getByPlaceholder("Contraseña").fill("contraseña-incorrecta");
    await modal.getByRole("button", { name: /Entrar/ }).click();

    // Aparece un error (Supabase rechaza las credenciales).
    await expect(modal.getByText(/invalid login|credenciales|no se obtuvo|usuario no/i)).toBeVisible({ timeout: 15000 });
    // Sigue en la landing: ni navegó a /dashboard ni recargó en bucle.
    await expect(page).toHaveURL(/\/$/);
    await expect(modal.getByPlaceholder("Email")).toBeVisible();
  });
});
