import { expect, test, type Page, type Route } from "@playwright/test";

// e2e del panel Móvil del landing-builder (change `aa-bug-mobile-zip-deshabilitado`).
// El botón "📱 Descargar mobile.zip" deshabilitado NO era un fallo: sin app móvil
// generada no hay zip que bajar. El fallo era de comunicación —la landing sí decía
// por qué y el móvil no— y que el error del backend se tragaba en silencio. Esto
// fija ambas cosas: el motivo se ve, y el 422 llega al usuario con su detalle.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};

function fulfillJson(route: Route, body: unknown) {
  if (route.request().method() === "OPTIONS") {
    return route.fulfill({ status: 204, headers: CORS_HEADERS });
  }
  return route.fulfill({
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ANSWERS = Object.fromEntries(
  [
    "purpose", "businessName", "palette", "style", "images",
    "sections", "cta", "contact", "database", "language",
  ].map((k) => [k, { value: "x", assumedByAI: false }]),
);

function proyecto(over: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "Landing de prueba",
    business: null,
    answers: ANSWERS,
    chatMessages: [],
    generationPrompt: null,
    dbProvider: "none",
    files: { "index.html": "<html><body>hola</body></html>" },
    mobileFiles: {},
    mobileStack: null,
    qrUrl: null,
    status: "generated",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

async function abrirPanelMovil(page: Page, project: Record<string, unknown>) {
  await page.route("**/api/**", (route) => fulfillJson(route, {}));
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/landing/proj-1", (route) => fulfillJson(route, project));

  await page.goto("/landing-builder/proj-1");
  await page.getByRole("button", { name: "📱 Móvil" }).click();
  await expect(page.getByRole("button", { name: /Descargar mobile\.zip/ })).toBeVisible();
}

const botonMobileZip = (page: Page) => page.getByRole("button", { name: /Descargar mobile\.zip/ });

test.describe("Landing builder · panel Móvil", () => {
  test("sin app móvil generada: el botón está deshabilitado y dice por qué", async ({ page }) => {
    await abrirPanelMovil(page, proyecto());

    await expect(botonMobileZip(page)).toBeDisabled();
    // El motivo, en texto visible — no sólo en el `title`, que un botón deshabilitado
    // no expone de forma fiable ni por teclado ni a un lector de pantalla.
    await expect(page.getByText("Genera la app móvil (Android o iOS) para descargar el zip")).toBeVisible();
    // La landing sí existe, así que su propio aviso NO debe apilarse encima.
    await expect(page.getByText("Genera la landing primero para descargar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Descargar landing\.zip/ })).toBeEnabled();
  });

  test("con app móvil ya generada el botón se habilita solo al recargar", async ({ page }) => {
    // `GET /api/landing/:id` devuelve `mobileFiles` entero (findUnique sin select),
    // así que volver a entrar basta: no hace falta regenerar nada.
    await abrirPanelMovil(page, proyecto({ mobileFiles: { "App.tsx": "export default () => null;" }, mobileStack: "expo" }));

    await expect(botonMobileZip(page)).toBeEnabled();
    await expect(page.getByText("Genera la app móvil (Android o iOS) para descargar el zip")).toHaveCount(0);
  });

  test("si el backend falla al generar, el motivo real llega al usuario", async ({ page }) => {
    await abrirPanelMovil(page, proyecto());

    await page.route("**/api/landing/proj-1/mobile", (route) =>
      route.fulfill({
        status: 422,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Failed to generate mobile scaffold" }),
      }),
    );

    await page.getByRole("button", { name: /Android/ }).first().click();

    // Antes el `catch {}` se lo tragaba y pintaba un genérico; ahora se ve el detalle.
    await expect(page.getByText(/Failed to generate mobile scaffold/)).toBeVisible();
  });
});
