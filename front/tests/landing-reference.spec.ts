import { expect, test, type Page, type Route } from "@playwright/test";

// Referencia de diseño (URL o fichero HTML) en el chat del decálogo.
// El backend ya extrae estructura + paleta + tipografías y las guarda en
// `answers.reference`; aquí se prueba el camino de UI: cuerpo enviado, resumen
// aplicado, errores del backend (400 REFERENCE_BLOCKED) y rechazo cliente de
// ficheros que no son HTML (sin llegar a hacer petición).

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

function fulfillError(route: Route, status: number, code: string) {
  if (route.request().method() === "OPTIONS") {
    return route.fulfill({ status: 204, headers: CORS_HEADERS });
  }
  return route.fulfill({
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ error: code, code }),
  });
}

// Decálogo a medias: el chat queda visible (con decálogo completo el panel
// salta solo a la pestaña Prompts).
const ANSWERS = {
  purpose: { value: "Landing de una clínica dental", assumedByAI: false },
  businessName: { value: "Clínica Sonrisa", assumedByAI: false },
  palette: { value: "azul y blanco", assumedByAI: false },
};

const HISTORY = [{ role: "assistant", content: "¿Cuál es el propósito de la landing?" }];

const PROJECT = {
  id: "proj-1",
  name: "Landing de prueba",
  business: null,
  answers: ANSWERS,
  chatMessages: HISTORY,
  generationPrompt: null,
  dbProvider: "none",
  files: {},
  mobileFiles: {},
  mobileStack: null,
  qrUrl: null,
  status: "draft",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const REFERENCE_URL = {
  kind: "url" as const,
  source: "ejemplo.com",
  structure: ["header (h1, 1 CTA)", "section (3 tarjetas)", "footer"],
  palette: ["#0f172a", "#4338ca"],
  fonts: ["Inter", "Georgia"],
};

const REFERENCE_FILE = {
  kind: "file" as const,
  source: "referencia.html",
  structure: ["hero (h1)"],
  palette: ["#ff5500"],
  fonts: ["Roboto"],
};

const NEXT_QUESTION = "¿Qué tipografía quieres para los títulos?";

const HTML_FILE_CONTENT = "<!doctype html><html><body><h1>Hola</h1></body></html>";

interface ChatBody {
  message: string | null;
  messages?: Array<{ role: string; content: string }>;
  reference?: { url?: string; file?: { name: string; content: string } };
}

/** Mockea el builder y devuelve el array donde se acumulan los cuerpos de /chat. */
async function abrirChat(page: Page): Promise<ChatBody[]> {
  const bodies: ChatBody[] = [];

  await page.route("**/api/**", (route) => fulfillJson(route, {}));
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/landing/proj-1", (route) => fulfillJson(route, PROJECT));
  // Registrada después para que gane a la ruta genérica de arriba.
  await page.route("**/api/landing/proj-1/chat", (route) => {
    if (route.request().method() === "OPTIONS") {
      return fulfillJson(route, {});
    }
    bodies.push(JSON.parse(route.request().postData() ?? "{}") as ChatBody);
    return fulfillJson(route, {
      question: NEXT_QUESTION,
      done: false,
      answers: { ...ANSWERS, reference: { value: "pautas guardadas", assumedByAI: false } },
      area: "style",
      reference: REFERENCE_URL,
    });
  });

  await page.goto("/landing-builder/proj-1");
  await expect(page.getByRole("button", { name: "Añadir referencia" })).toBeVisible();
  return bodies;
}

async function aplicarEnlace(page: Page, url: string) {
  await page.getByRole("button", { name: "Añadir referencia" }).click();
  await page.getByLabel("URL de referencia").fill(url);
  await page.getByRole("button", { name: "Usar enlace" }).click();
}

test.describe("Landing builder · referencia de diseño", () => {
  test("el enlace se envía como referencia y el resumen muestra pauta, paleta y tipografías", async ({ page }) => {
    const bodies = await abrirChat(page);

    await aplicarEnlace(page, "https://ejemplo.com");

    const resumen = page.getByTestId("reference-summary");
    await expect(resumen).toBeVisible();
    // Origen de la referencia.
    await expect(resumen).toContainText("ejemplo.com");
    // Estructura, en orden y unida por flechas.
    await expect(resumen).toContainText("header (h1, 1 CTA) → section (3 tarjetas) → footer");
    // Paleta: una muestra por color, con su hex.
    await expect(resumen.getByTestId("reference-swatch")).toHaveCount(2);
    await expect(resumen).toContainText("#0f172a");
    await expect(resumen).toContainText("#4338ca");
    // Tipografías.
    await expect(resumen).toContainText("Inter");
    await expect(resumen).toContainText("Georgia");
    // Aviso de que solo son pautas de estilo.
    await expect(resumen).toContainText("no se copian textos, imágenes ni logo");
    // La entrevista continúa como un turno normal.
    await expect(page.getByText(NEXT_QUESTION)).toBeVisible();

    // Cuerpo enviado: turno sin mensaje, historial actual y solo el enlace.
    expect(bodies).toHaveLength(1);
    expect(bodies[0].message).toBeNull();
    expect(bodies[0].reference).toEqual({ url: "https://ejemplo.com" });
    expect(bodies[0].messages).toEqual(HISTORY);
  });

  test("un 400 REFERENCE_BLOCKED muestra el aviso de URL no permitida y ningún resumen", async ({ page }) => {
    await abrirChat(page);
    await page.route("**/api/landing/proj-1/chat", (route) => {
      if (route.request().method() === "OPTIONS") return fulfillJson(route, {});
      return fulfillError(route, 400, "REFERENCE_BLOCKED");
    });

    await aplicarEnlace(page, "http://192.168.0.10/admin");

    await expect(
      page.getByText("Esa URL no está permitida (no es una dirección pública)."),
    ).toBeVisible();
    await expect(page.getByTestId("reference-summary")).toHaveCount(0);
  });

  test("un fichero que no es HTML se rechaza en el cliente, sin enviar nada", async ({ page }) => {
    const bodies = await abrirChat(page);

    await page.getByRole("button", { name: "Añadir referencia" }).click();
    await page
      .locator('input[type="file"][accept=".html,.htm"]')
      .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from("png") });

    await expect(page.getByText("Solo se admiten ficheros HTML (.html, .htm).")).toBeVisible();
    await expect(page.getByTestId("reference-summary")).toHaveCount(0);
    expect(bodies).toHaveLength(0);
  });

  test("un fichero HTML se envía con su nombre y contenido de texto", async ({ page }) => {
    const bodies = await abrirChat(page);
    await page.route("**/api/landing/proj-1/chat", (route) => {
      if (route.request().method() === "OPTIONS") return fulfillJson(route, {});
      bodies.push(JSON.parse(route.request().postData() ?? "{}") as ChatBody);
      return fulfillJson(route, {
        question: NEXT_QUESTION,
        done: false,
        answers: ANSWERS,
        area: "style",
        reference: REFERENCE_FILE,
      });
    });

    await page.getByRole("button", { name: "Añadir referencia" }).click();
    await page
      .locator('input[type="file"][accept=".html,.htm"]')
      .setInputFiles({ name: "referencia.html", mimeType: "text/html", buffer: Buffer.from(HTML_FILE_CONTENT) });

    const resumen = page.getByTestId("reference-summary");
    await expect(resumen).toBeVisible();
    await expect(resumen).toContainText("referencia.html");
    await expect(resumen).toContainText("#ff5500");

    expect(bodies).toHaveLength(1);
    expect(bodies[0].reference).toEqual({
      file: { name: "referencia.html", content: HTML_FILE_CONTENT },
    });
  });

  test("un turno normal del chat sigue enviando el mensaje y sin referencia", async ({ page }) => {
    const bodies = await abrirChat(page);

    await page.getByPlaceholder("Escribe tu respuesta...").fill("Somos una clínica dental");
    await page.getByRole("button", { name: "→" }).click();

    await expect(page.getByText("Somos una clínica dental")).toBeVisible();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].message).toBe("Somos una clínica dental");
    expect(bodies[0].reference).toBeUndefined();
  });
});
