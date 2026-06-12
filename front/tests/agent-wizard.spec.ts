import { expect, type Page, test } from "@playwright/test";

async function mockWizardApi(page: Page) {
  await page.route("http://localhost:4000/api/sectors?**", async (route) => {
    await route.fulfill({
      json: {
        items: ["Dentistas", "Inmobiliaria", "Otro"],
        page: 1,
        totalPages: 1,
      },
    });
  });

  await page.route("http://localhost:4000/api/sectors", async (route) => {
    await route.fulfill({ json: { id: "sector-legal", name: "Legal" } });
  });

  await page.route("http://localhost:4000/api/skills/uses", async (route) => {
    await route.fulfill({ json: ["VENTAS", "SOPORTE"] });
  });

  await page.route("http://localhost:4000/api/skills?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: "skill-crm",
            name: "CRM Lead Capture",
            description: "Captura leads y sincroniza datos comerciales",
            type: "SKILL",
            use: "VENTAS",
            repoUrl: "https://github.com/example/crm",
            stars: 12,
            tools: [],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      },
    });
  });

  await page.route("http://localhost:4000/api/agents", async (route) => {
    await route.fulfill({ json: { id: "agent-1" } });
  });
}

test("wizard adds custom sector, selects marketplace skill and saves widget config", async ({ page }) => {
  await mockWizardApi(page);

  await page.goto("/agents/new");

  await page.getByPlaceholder(/Nombre del cliente/).fill("Cliente Legal");
  await page.getByPlaceholder(/Web del cliente/).fill("https://cliente.example");
  await page.getByRole("button", { name: "Siguiente" }).last().click();

  await page.getByRole("button", { name: "Otro" }).click();
  await expect(page.getByPlaceholder("Introduce el Sector")).toBeVisible();
  await expect(page.getByRole("button", { name: "Añadir" })).toBeDisabled();
  await page.getByPlaceholder("Introduce el Sector").fill("Legal");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByText("✓ Añadido correctamente")).toBeVisible();

  // Paso 3: Canal (widget seleccionado por defecto, con plantilla visible)
  await page.getByRole("button", { name: "Siguiente" }).last().click();
  await page.locator("input.input-dark").nth(0).fill("#0f766e");
  await page.locator("input.input-dark").nth(2).fill("⚙️");

  // Paso 4: Personalidad (prompt autogenerado con el sector)
  await page.getByRole("button", { name: "Siguiente" }).last().click();
  await expect(page.locator("textarea")).toContainText("Legal");

  // Paso 5: Skills
  await page.getByRole("button", { name: "Siguiente" }).last().click();
  await page.getByPlaceholder("Buscar por nombre...").fill("CRM");
  await page.getByLabel(/CRM Lead Capture/).check();

  await page.getByRole("button", { name: "Siguiente" }).last().click();
  await page.getByRole("button", { name: "Crear agente" }).click();

  await expect(page).toHaveURL(/\/agents\/agent-1/);
});
