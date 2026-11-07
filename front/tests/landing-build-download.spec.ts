import { expect, test, type Page, type Route } from "@playwright/test";

// e2e de "Descargar build" (change `landing-build-paths`, S9): la descarga de la landing
// pasa por `POST /api/landing/:id/build`, que devuelve un ZIP con TODO bajo `<slug>/`
// y el nombre en `Content-Disposition`. El ZIP cliente que había en el panel Móvil no
// respetaba esa raíz, así que se retira; el de móvil se queda intacto.
//
// Hermético: nada sale a la red. El backend se simula con `page.route` y el ZIP se
// entrega con la cabecera real (`application/zip` + `Content-Disposition`).

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  // Sin esto el navegador esconde `Content-Disposition` al JS y el nombre del fichero
  // nunca llegaría a la descarga.
  "Access-Control-Expose-Headers": "content-disposition",
};

function preflight(route: Route) {
  return route.fulfill({ status: 204, headers: CORS_HEADERS });
}

function fulfillJson(route: Route, body: unknown) {
  if (route.request().method() === "OPTIONS") return preflight(route);
  return route.fulfill({
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** ZIP vacío (cabecera de un zip vacío válido) para no inventar bytes. */
const EMPTY_ZIP = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

function fulfillZip(route: Route, filename?: string) {
  if (route.request().method() === "OPTIONS") return preflight(route);
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    "Content-Type": "application/zip",
  };
  if (filename) headers["Content-Disposition"] = `attachment; filename="${filename}"`;
  return route.fulfill({ status: 200, headers, body: EMPTY_ZIP });
}

function fulfillError(route: Route, status: number, body: unknown) {
  if (route.request().method() === "OPTIONS") return preflight(route);
  return route.fulfill({
    status,
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

const botonDescargar = (page: Page) => page.getByRole("button", { name: "Descargar build" });

async function abrirPanelMovil(page: Page, project: Record<string, unknown>) {
  await page.route("**/api/**", (route) => fulfillJson(route, {}));
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/landing/proj-1", (route) => fulfillJson(route, project));

  await page.goto("/landing-builder/proj-1");
  await page.getByRole("button", { name: "📱 Móvil" }).click();
  await expect(botonDescargar(page)).toBeVisible();
}

/** Captura los cuerpos POST del endpoint de build; la ruta registrada gana a la genérica. */
async function mockBuild(page: Page, respond: (route: Route, body: any) => unknown) {
  const bodies: any[] = [];
  await page.route("**/api/landing/proj-1/build", (route) => {
    if (route.request().method() === "OPTIONS") return preflight(route);
    const body = JSON.parse(route.request().postData() ?? "{}");
    bodies.push(body);
    return respond(route, body);
  });
  return bodies;
}

test.describe("Landing builder · descargar build", () => {
  test("con la vía Automática no se envía `mode` y el nombre del servidor se usa", async ({ page }) => {
    await abrirPanelMovil(page, proyecto());

    // "Automática" es la opción por defecto: deja que el backend decida la vía.
    await expect(page.getByLabel("Vía de build")).toHaveValue("auto");

    const bodies = await mockBuild(page, (route) => fulfillZip(route, "landing-de-prueba.zip"));

    const descarga = page.waitForEvent("download");
    await botonDescargar(page).click();
    const download = await descarga;

    // Nombre tomado de `Content-Disposition`, no inventado por el cliente.
    expect(download.suggestedFilename()).toBe("landing-de-prueba.zip");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty("mode");
  });

  test("si el servidor no manda Content-Disposition, el fichero se llama landing.zip", async ({ page }) => {
    await abrirPanelMovil(page, proyecto());

    await mockBuild(page, (route) => fulfillZip(route));

    const descarga = page.waitForEvent("download");
    await botonDescargar(page).click();
    const download = await descarga;

    expect(download.suggestedFilename()).toBe("landing.zip");
  });

  test("elegir Next envía mode=next, avisa de la espera y descarga al terminar", async ({ page }) => {
    await abrirPanelMovil(page, proyecto());

    let liberar: () => void = () => {};
    const puerta = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const bodies = await mockBuild(page, async (route) => {
      await puerta;
      return fulfillZip(route, "landing-next.zip");
    });

    await page.getByLabel("Vía de build").selectOption("next");

    const descarga = page.waitForEvent("download");
    await botonDescargar(page).click();

    // El build de Next tarda ~20 s: mientras corre, el botón se bloquea y se avisa.
    await expect(page.getByText("Construyendo con Next (puede tardar ~20 s)…")).toBeVisible();
    await expect(botonDescargar(page)).toBeDisabled();

    liberar();
    const download = await descarga;
    expect(download.suggestedFilename()).toBe("landing-next.zip");
    expect(bodies[0]).toEqual({ mode: "next" });
    await expect(botonDescargar(page)).toBeEnabled();
  });

  test("una imagen que no se puede traer muestra qué URL falló", async ({ page }) => {
    await abrirPanelMovil(page, proyecto());

    const url = "https://cdn.example.com/foto-rota.png";
    await mockBuild(page, (route) =>
      fulfillError(route, 422, {
        error: "No se pudo descargar la imagen",
        code: "IMAGE_UNAVAILABLE",
        details: { url },
      }),
    );

    await botonDescargar(page).click();

    await expect(page.getByText(`No se pudo descargar una imagen: ${url}`)).toBeVisible();
    await expect(botonDescargar(page)).toBeEnabled();
  });

  test("si falta el constructor de Next, el mensaje trae el comando para crearlo", async ({ page }) => {
    await abrirPanelMovil(page, proyecto());

    await mockBuild(page, (route) =>
      fulfillError(route, 503, {
        error: "El build de Next no está disponible en este servidor",
        code: "NEXT_BUILDER_UNAVAILABLE",
        details: { command: "npm run landing:next-image" },
      }),
    );

    await page.getByLabel("Vía de build").selectOption("next");
    await botonDescargar(page).click();

    await expect(page.getByText(/npm run landing:next-image/)).toBeVisible();
  });

  test("el zip de móvil sigue funcionando igual", async ({ page }) => {
    await abrirPanelMovil(
      page,
      proyecto({ mobileFiles: { "App.tsx": "export default () => null;" }, mobileStack: "expo" }),
    );

    const descarga = page.waitForEvent("download");
    await page.getByRole("button", { name: /Descargar mobile\.zip/ }).click();
    const download = await descarga;

    expect(download.suggestedFilename()).toBe("mobile-expo.zip");
  });
});
