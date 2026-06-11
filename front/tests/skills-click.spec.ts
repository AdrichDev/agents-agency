import { expect, type Page, test } from "@playwright/test";

async function mockSkillsApi(page: Page) {
  await page.route("http://localhost:4000/api/skills/categories", async (route) => {
    await route.fulfill({ json: ["general", "ventas"] });
  });
  await page.route("http://localhost:4000/api/skills?**", async (route) => {
    await route.fulfill({
      json: {
        items: Array.from({ length: 25 }, (_, index) => ({
          id: `skill-${index + 1}`,
          name: `Skill ${index + 1}`,
          description: "Skill de prueba para marketplace",
          category: index % 2 ? "ventas" : "general",
          repoUrl: "https://github.com/example/repo",
          stars: 10,
          tools: [],
        })),
        total: 100,
        page: 1,
        pageSize: 25,
        totalPages: 4,
      },
    });
  });
  await page.route("http://localhost:4000/api/skills", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ json: { discovered: 1, updated: 0, scanned: 1 } });
      return;
    }
    await route.continue();
  });
}

test("skills marketplace hydrates and discover button reacts to clicks", async ({ page }) => {
  await mockSkillsApi(page);

  await page.goto("/skills");

  await expect(page.getByText(/disponibles/)).toContainText("100", { timeout: 10_000 });

  await expect(page.getByText(/25 por página/)).toBeVisible();

  await page.getByRole("button", { name: /Descubrir.*GitHub/i }).click();

  await expect(page.getByRole("button", { name: /Descubriendo/i })).toBeVisible();
});
