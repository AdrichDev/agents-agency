import { test, expect } from "@playwright/test";
import { NAV_GROUPS, NAV_ITEMS, NAV_TITLE } from "../lib/navigation";

// Structural tests for the grouped sidebar navigation
// (aa-navegacion-lateral-agrupada). Sidebar renders on any non-"/" route
// regardless of auth state (AppShell), so these checks do not require an
// authenticated session — same pattern as facturas.spec.ts / cuenta.spec.ts.

test.describe("Sidebar — navegación agrupada", () => {
  test("renderiza el título de navegación y títulos de sección estilo OperaOS", async ({ page }) => {
    await page.goto("/facturas");

    await expect(page.locator("aside").getByText(NAV_TITLE, { exact: true })).toBeVisible();
    await expect(page.locator("aside").getByText("ADRICH", { exact: true })).toHaveCount(0);

    const sectionTitles = page.locator('[data-testid="sidebar-section-title"]');
    await expect(sectionTitles.first()).toHaveClass(/text-\[10px\]/);
    await expect(sectionTitles.first()).toHaveClass(/tracking-\[0\.12em\]/);
    await expect(sectionTitles.first()).toHaveClass(/text-slate-500/);
  });

  test("la data de navegación expone Centro de Mando y Agenda", () => {
    expect(NAV_TITLE).toBe("Centro de Mando");
    expect(NAV_GROUPS[0]?.label).toBe("Área de Trabajo");
    expect(NAV_GROUPS[0]?.items.map((item) => item.href)).toEqual([
      "/dashboard",
      "/cuenta",
      "/configuracion",
      "/agenda",
      "/telegram",
    ]);
    expect(NAV_ITEMS.map((item) => item.href)).toContain("/agenda");
  });

  test("los grupos aparecen en el orden de negocio", async ({ page }) => {
    await page.goto("/facturas");
    const groupLabels = page.locator('[data-testid="sidebar-section-title"]');
    await expect(groupLabels).toHaveText([
      "Área de Trabajo",
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
      "Agenda",
      "Telegram",
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

  test("marca Agenda como ruta activa con estado semantico", async ({ page }) => {
    await page.goto("/agenda");

    const agendaLink = page.getByRole("link", { name: "Agenda" });
    await expect(agendaLink).toHaveAttribute("aria-current", "page");
    await expect(agendaLink).toHaveClass(/font-bold/);

    const dashboardLink = page.getByRole("link", { name: "Dashboard" });
    await expect(dashboardLink).not.toHaveAttribute("aria-current", "page");
  });

  test("el modo colapsado oculta títulos de grupo pero conserva navegación", async ({ page }) => {
    await page.goto("/facturas");
    await page.getByTitle("Colapsar sidebar").click();

    await expect(page.locator('[data-testid="sidebar-section-title"]')).toHaveCount(0);

    const dashboardLink = page.locator('nav a[href="/dashboard"]');
    await expect(dashboardLink).toHaveAttribute("title", "Dashboard");
    await expect(dashboardLink).toBeVisible();
  });
});
