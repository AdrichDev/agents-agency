import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * e2e del widget de 3A Estudio en la web de 3A Estudio (aa-widget-3a-en-su-propia-web,
 * T4.1). Lo que se prueba NO es el widget en sí (eso vive en las pruebas del back), sino
 * DÓNDE aparece: solo en las rutas públicas. El snippet estaba en `RootLayout` sin
 * condición, así que activarlo tal cual habría dejado un bot comercial flotando también
 * sobre el panel del operador y el portal del cliente.
 *
 * Sigue el patrón de telegram-widget.spec.ts: sesión Supabase falsa en localStorage para
 * que la ruta privada no rebote al login (`lib/api.ts` manda un 401 a `/?returnTo=…`, y
 * `/` es pública: sin sesión la burbuja reaparecería y la prueba sería un falso verde).
 */

/** Resuelve NEXT_PUBLIC_SUPABASE_URL igual que Next (.env.local / .env / process.env). */
function resolveSupabaseUrl(): string | null {
  for (const file of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(path.join(__dirname, "..", file), "utf8");
      const match = raw.match(/^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*(.+?)\s*$/m);
      if (match) return match[1].replace(/^["']|["']$/g, "");
    } catch {
      /* fichero ausente: probar el siguiente */
    }
  }
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
}

/** Clave por defecto de supabase-js v2: sb-<project-ref>-auth-token. */
function supabaseStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

/** Sesión con expiración lejana: getSession() la devuelve sin refresh de red. */
function buildFakeSession() {
  const nowSec = Math.floor(Date.now() / 1000);
  const b64url = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    sub: "e2e-site-widget-user",
    role: "authenticated",
    exp: nowSec + 3600,
  })}.e2e-signature`;

  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: nowSec + 3600,
    refresh_token: "e2e-refresh-token",
    user: {
      id: "e2e-site-widget-user",
      aud: "authenticated",
      role: "authenticated",
      email: "e2e-site-widget@test.local",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    },
  };
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};

/** Fulfill JSON con CORS (el back vive en otro origen) y soporte de preflight. */
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

// `back/public/widget.js` DE VERDAD, no un doble: es el fichero que se sirve tal cual a
// navegadores de terceros y el que decide qué nodos (#aa-bubble, #aa-panel, #aa-style)
// acaban en el documento. Un doble probaría la existencia del <script>, no la burbuja.
const WIDGET_SOURCE = readFileSync(
  path.join(__dirname, "..", "..", "back", "public", "widget.js"),
  "utf8",
);

/** Nodos que deja `widget.js`; los mismos que `SiteWidget` retira al desmontarse. */
const WIDGET_NODE_IDS = ["aa-bubble", "aa-panel", "aa-style"] as const;

/**
 * Sirve `widget.js` desde disco y neutraliza el resto del back:
 *  - catch-all /api/** → {} (config del widget, sidebar, /api/auth/me…). Sin esto la
 *    ruta privada recibe un 401 y `lib/api.ts` la manda a `/`, que es pública.
 */
async function stubBackend(page: Page) {
  await page.route("**/widget.js", (route) =>
    route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/javascript" },
      body: WIDGET_SOURCE,
    }),
  );
  await page.route("**/api/**", (route) => fulfillJson(route, {}));
}

async function seedSession(page: Page, supabaseUrl: string) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [supabaseStorageKey(supabaseUrl), JSON.stringify(buildFakeSession())] as const,
  );
}

test.describe("SiteWidget — el chat de 3A solo en las rutas públicas", () => {
  const supabaseUrl = resolveSupabaseUrl();

  test("la burbuja aparece en la landing", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/");

    await expect(page.locator("#aa-bubble")).toBeVisible();
    // Una sola: `RootLayout` monta el widget una vez y `widget.js` se autoprotege.
    await expect(page.locator("#aa-bubble")).toHaveCount(1);
  });

  test("la burbuja aparece también en las páginas legales", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/aviso-legal");

    // Son rutas públicas: quien llega al aviso legal desde el pie de la landing sigue
    // siendo un visitante, y tiene que poder seguir preguntando.
    await expect(page.locator("#aa-bubble")).toBeVisible();
  });

  test("el script apunta al agente de 3A", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/");

    // `data-agent-key` es lo único que ata la burbuja a un agente concreto: si se pierde,
    // `widget.js` carga contra el agente equivocado (o contra ninguno) sin fallar.
    const script = page.locator("script[data-aa-site-widget]");
    await expect(script).toHaveCount(1);
    expect(await script.getAttribute("data-agent-key")).toMatch(/^\w{20,}$/);
  });

  // Estar en el DOM no es estar a la vista. La burbuja se sirvió en producción tapada por
  // el aviso de cookies, que ocupaba el mismo rincón: presente, clicable por selector, e
  // invisible para quien entraba en la web. Se comprueba en móvil, que es donde el banner
  // cruza la pantalla de lado a lado.
  test("el aviso de cookies no tapa la burbuja", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await stubBackend(page);
    await page.goto("/");

    const bubble = page.locator("#aa-bubble");
    await expect(bubble).toBeVisible();
    await expect(page.getByText("Usamos cookies")).toBeVisible();

    // Quien recibe el toque en el centro de la burbuja tiene que ser la burbuja. Si el
    // banner se la come, `elementFromPoint` devuelve el banner y esto falla.
    const caja = await bubble.boundingBox();
    expect(caja).not.toBeNull();
    const alcanzable = await page.evaluate(
      ([x, y]) => {
        const encima = document.elementFromPoint(x, y);
        const burbuja = document.getElementById("aa-bubble");
        return Boolean(encima && burbuja && (encima === burbuja || burbuja.contains(encima)));
      },
      [caja!.x + caja!.width / 2, caja!.y + caja!.height / 2] as const,
    );
    expect(alcanzable).toBe(true);

    // Y no basta con quedar por encima: solaparse deja el chat pegado a los botones del
    // aviso, que es como se perdía de vista. Las dos cajas no se tocan.
    const banner = await page.locator("text=Usamos cookies").locator("xpath=ancestor::div[1]").boundingBox();
    expect(banner).not.toBeNull();
    const seSolapan =
      caja!.x < banner!.x + banner!.width &&
      caja!.x + caja!.width > banner!.x &&
      caja!.y < banner!.y + banner!.height &&
      caja!.y + caja!.height > banner!.y;
    expect(seSolapan).toBe(false);
  });

  // aa-servicios-completos-y-enlaces-clicables, A: la web decía "chatbots" y poco más,
  // así que quien buscaba un CRM o una web se iba. Los seis servicios que vende la agencia
  // tienen que estar escritos donde el visitante los lee, no solo en la cabeza del bot.
  test("la landing anuncia los seis servicios, no solo los chatbots", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/");

    for (const servicio of [
      "Agentes IA para WhatsApp y Telegram",
      "CRM a medida",
      "Webs completas y landing pages",
      "Automatizaciones e integraciones",
    ]) {
      // Cada tarjeta pinta su título dos veces (cara frontal y reverso del giro).
      await expect(
        page.getByRole("heading", { name: servicio, exact: true }).first(),
      ).toBeVisible();
    }
  });

  // aa-servicios-completos-y-enlaces-clicables, C.2: en una conversación real el agente
  // ofreció la política de privacidad tres veces y el visitante recibió corchetes literales.
  // Y cuando por fin es un enlace, no puede llevarse la conversación por delante: se abre
  // en pestaña nueva.
  test("un enlace del bot se pinta clicable y abre en pestaña nueva", async ({ page }) => {
    const PRIVACIDAD = "https://3aestudio.vercel.app/privacidad";
    await stubBackend(page);
    // Se registra DESPUÉS del catch-all: Playwright resuelve la última ruta que encaja.
    await page.route("**/api/chat", (route) =>
      fulfillJson(route, {
        text: `Aquí la tienes: [Política de privacidad](${PRIVACIDAD})`,
        conversationId: "conv-e2e",
      }),
    );
    await page.goto("/");

    await page.locator("#aa-bubble").click();
    await page.locator("#aa-input").fill("¿dónde está la política de privacidad?");
    await page.locator("#aa-form button[type=submit]").click();

    const enlace = page.locator("#aa-msgs .aa-m a");
    await expect(enlace).toHaveAttribute("href", PRIVACIDAD);
    await expect(enlace).toHaveText("Política de privacidad");
    await expect(enlace).toHaveAttribute("target", "_blank");
    // Sin `noopener`, la pestaña que se abre recibe un `window.opener` vivo hacia la web.
    await expect(enlace).toHaveAttribute("rel", /noopener/);
  });

  // D: "la sesión y el chat tienen que persistir mientras esté la pestaña abierta".
  test("la conversación sobrevive a un recargado de la página", async ({ page }) => {
    await stubBackend(page);
    await page.route("**/api/chat", (route) =>
      fulfillJson(route, { text: "Sí, hacemos CRMs a medida.", conversationId: "conv-e2e" }),
    );
    await page.goto("/");

    await page.locator("#aa-bubble").click();
    await page.locator("#aa-input").fill("¿hacéis CRMs?");
    await page.locator("#aa-form button[type=submit]").click();
    await expect(page.locator("#aa-msgs .aa-m")).toHaveText([
      /¿Cómo te llamas\?$/,
      "¿hacéis CRMs?",
      "Sí, hacemos CRMs a medida.",
    ]);

    await page.reload();

    // Sin volver a abrir el panel: el widget repinta lo guardado al arrancar, y no vuelve
    // a saludar a alguien que ya está a mitad de conversación. El saludo NO se guarda a
    // propósito: lleva el nombre del agente, que llega con la config del back, y
    // persistirlo congelaría el "Asistente" por defecto de un arranque en frío.
    await expect(page.locator("#aa-msgs .aa-m")).toHaveText([
      "¿hacéis CRMs?",
      "Sí, hacemos CRMs a medida.",
    ]);
  });

  test("no hay burbuja en una ruta autenticada", async ({ page }) => {
    test.skip(
      !supabaseUrl,
      "NEXT_PUBLIC_SUPABASE_URL is required to seed a Supabase session (front/.env.local)",
    );
    await stubBackend(page);
    await seedSession(page, supabaseUrl!);
    await page.goto("/agenda");

    // El chrome del dashboard montado confirma que seguimos en la ruta privada y que la
    // ausencia de burbuja no es por un rebote al login.
    await expect(page.getByTestId("telegram-widget-chip")).toBeVisible();
    for (const id of WIDGET_NODE_IDS) {
      await expect(page.locator(`#${id}`)).toHaveCount(0);
    }
  });
});
