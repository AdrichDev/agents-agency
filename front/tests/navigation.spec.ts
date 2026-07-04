import { test, expect } from "@playwright/test";

// Structural tests for the grouped sidebar navigation
// (aa-navegacion-lateral-agrupada). Sidebar renders on any non-"/" route
// regardless of auth state (AppShell), so these checks do not require an
// authenticated session — same pattern as facturas.spec.ts / cuenta.spec.ts.

test.describe("Sidebar — navegación agrupada", () => {
  test("los grupos aparecen en el orden de negocio", async ({ page }) => {
    await page.goto("/facturas");
    const groupLabels = page.locator("nav .kicker");
    await expect(groupLabels).toHaveText([
      "Nombre grupal",
      "Pedidos",
      "Clientes / Lead",
      "Facturación",
      "Data",
    ]);
  });

  test("cada grupo contiene los items pedidos en orden", async ({ page }) => {
    await page.goto("/facturas");
    const linkTexts = await page.locator("nav a").allTextContents();
    const expectedLabels = [
      "Dashboard",
      "Mi Cuenta",
      "Configuración",
      "Nuevo Agente",
      "Marketplace",
      "Landing Builder",
      "Clientes",
      "Contactos",
      "Presupuestos",
      "Facturas",
      "Tarifas",
      "Estadísticas",
    ];
    expect(linkTexts).toHaveLength(expectedLabels.length);
    expectedLabels.forEach((label, i) => {
      expect(linkTexts[i]).toContain(label);
    });
  });

  test("el primer grupo muestra 'Dashboard' y no 'Panel de Control'", async ({ page }) => {
    await page.goto("/facturas");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Panel de Control")).toHaveCount(0);
  });

  test("la ruta activa se mantiene resaltada dentro de su grupo", async ({ page }) => {
    await page.goto("/facturas");
    const facturasLink = page.getByRole("link", { name: "Facturas" });
    await expect(facturasLink).toHaveClass(/font-bold/);

    const clientesLink = page.locator('nav a[href="/clientes"]');
    await expect(clientesLink).not.toHaveClass(/font-bold/);
  });

  test("el modo colapsado oculta títulos de grupo pero conserva navegación", async ({ page }) => {
    await page.goto("/facturas");
    await page.getByTitle("Colapsar sidebar").click();

    await expect(page.locator("nav .kicker")).toHaveCount(0);

    const dashboardLink = page.locator('nav a[href="/dashboard"]');
    await expect(dashboardLink).toHaveAttribute("title", "Dashboard");
    await expect(dashboardLink).toBeVisible();
  });
});
