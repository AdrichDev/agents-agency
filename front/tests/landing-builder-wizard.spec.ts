import { expect, test, type Page, type Route } from "@playwright/test";

// Sonda del SetupWizard del landing-builder (change `aa-bug-modal-qr-tab`).
// El bug reportado —pulsar "🔳 QR" con el modal abierto no cambiaba de pestaña— NO es
// alcanzable: el modal es un overlay `fixed inset-0 z-50` que tapa esos botones. Este
// fichero recorre TODOS los caminos que sí lo son, para descartar que el usuario viese
// otra cosa: abrir/cerrar/reabrir en cualquier orden, y navegar dentro del asistente.

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

const PROJECT = {
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
};

async function abrirBuilder(page: Page) {
  await page.route("**/api/**", (route) => fulfillJson(route, {}));
  await page.route("**/api/agents", (route) =>
    fulfillJson(route, [{ id: "ag-1", name: "Agente uno", publicKey: "pk_1", integrations: [] }]),
  );
  await page.route("**/api/landing/proj-1", (route) => fulfillJson(route, PROJECT));

  await page.goto("/landing-builder/proj-1");
  // El decálogo está completo (10 respuestas), así que el panel salta a Prompts solo.
  await expect(page.getByRole("button", { name: "🤖 Incluir Bot" })).toBeVisible();
}

// Marcadores de paso: el contenido único de cada uno.
const PASO_BOT = { name: "Incluir un chatbot en la landing" };
const PASO_QR = { name: "Incluir código QR" };

async function esperarPaso(page: Page, paso: 1 | 2) {
  const bot = page.getByRole("checkbox", PASO_BOT);
  const qr = page.getByRole("checkbox", PASO_QR);
  if (paso === 1) {
    await expect(bot).toBeVisible();
    await expect(qr).toHaveCount(0);
  } else {
    await expect(qr).toBeVisible();
    await expect(bot).toHaveCount(0);
  }
  // El indicador de cabecera coincide con el contenido.
  await expect(page.locator("p.text-indigo-300")).toHaveText(paso === 1 ? "Chatbot" : "QR");
}

function cerrarWizard(page: Page) {
  return page.getByRole("button", { name: "✕" }).click();
}

test.describe("Landing builder · SetupWizard", () => {
  test("Bot → cerrar → QR: el asistente abre en la pestaña pedida", async ({ page }) => {
    await abrirBuilder(page);

    await page.getByRole("button", { name: "🤖 Incluir Bot" }).click();
    await esperarPaso(page, 1);

    await cerrarWizard(page);
    await page.getByRole("button", { name: "🔳 QR" }).click();
    await esperarPaso(page, 2);
  });

  test("QR → cerrar → Bot: también en el orden inverso", async ({ page }) => {
    await abrirBuilder(page);

    await page.getByRole("button", { name: "🔳 QR" }).click();
    await esperarPaso(page, 2);

    await cerrarWizard(page);
    await page.getByRole("button", { name: "🤖 Incluir Bot" }).click();
    await esperarPaso(page, 1);
  });

  test("reabrir el MISMO botón tras navegar dentro vuelve a su paso, no al último visitado", async ({ page }) => {
    await abrirBuilder(page);

    // Abrir en Bot y avanzar a mano hasta QR dentro del asistente.
    await page.getByRole("button", { name: "🤖 Incluir Bot" }).click();
    await page.getByRole("button", { name: "Siguiente" }).click();
    await esperarPaso(page, 2);

    // Cerrar y volver a pulsar Bot: debe volver al paso 1, no quedarse en el 2.
    await cerrarWizard(page);
    await page.getByRole("button", { name: "🤖 Incluir Bot" }).click();
    await esperarPaso(page, 1);
  });

  test("navegación interna Siguiente/Atrás mueve el paso", async ({ page }) => {
    await abrirBuilder(page);

    await page.getByRole("button", { name: "🤖 Incluir Bot" }).click();
    await esperarPaso(page, 1);
    await expect(page.getByRole("button", { name: "Atrás" })).toBeDisabled();

    await page.getByRole("button", { name: "Siguiente" }).click();
    await esperarPaso(page, 2);

    await page.getByRole("button", { name: "Atrás" }).click();
    await esperarPaso(page, 1);
  });

  test("con el asistente abierto, los botones Bot/QR NO son alcanzables (el overlay los tapa)", async ({ page }) => {
    await abrirBuilder(page);

    await page.getByRole("button", { name: "🤖 Incluir Bot" }).click();
    await esperarPaso(page, 1);

    // Éste es el escenario del bug reportado. No se puede ejecutar: el overlay
    // `fixed inset-0 z-50` intercepta el click. Se afirma la imposibilidad para que,
    // si algún día el modal deja de cubrir la pantalla, este test avise.
    const error = await page
      .getByRole("button", { name: "🔳 QR" })
      .click({ timeout: 2500 })
      .then(() => null, (e: Error) => e.message);

    expect(error).not.toBeNull();
    expect(error).toContain("intercepts pointer events");
  });
});
