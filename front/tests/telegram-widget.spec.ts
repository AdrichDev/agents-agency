import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * e2e del widget flotante de Telegram (aa-centro-mando-agenda-telegram, tareas 5.4d
 * y 5.5b). El widget es la única UI del canal: chip fijo abajo-derecha en páginas
 * autenticadas y panel con dos pestañas:
 *  - «Operador» (por defecto): hilo único con el Minion 3A vía /api/operator-chat/*.
 *  - «Clientes»: lista→hilo de /api/channels/telegram/*, envío optimista con
 *    clientMsgId y badge de no leídos.
 * Sigue el patrón de agenda.spec.ts: sesión Supabase falsa sembrada en localStorage
 * + page.route de los endpoints del back (vive en otro origen).
 */

/**
 * Resuelve NEXT_PUBLIC_SUPABASE_URL igual que Next (.env.local / .env / process.env).
 * Necesaria para calcular la clave de localStorage donde supabase-js persiste la sesión.
 */
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

/**
 * Sesión Supabase falsa con expiración lejana: getSession() la devuelve tal cual
 * (sin refresh de red) y getToken() adjunta su access_token como Bearer.
 */
function buildFakeSession() {
  const nowSec = Math.floor(Date.now() / 1000);
  const b64url = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    sub: "e2e-telegram-user",
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
      id: "e2e-telegram-user",
      aud: "authenticated",
      role: "authenticated",
      email: "e2e-telegram@test.local",
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

// ── Datos mockeados (misma forma que el back AA: Conversation + Message) ─────

const T_IN_1 = "2026-07-06T09:00:00.000Z";
const T_OUT_1 = "2026-07-06T09:05:00.000Z";
const T_IN_2 = "2026-07-06T09:10:00.000Z";
const T_IN_NEW = "2026-07-06T10:00:00.000Z";

const CONV1_MESSAGES = [
  { id: "m1", conversationId: "conv-1", role: "user", content: "Hola, quiero información de la agencia.", createdAt: T_IN_1 },
  { id: "m2", conversationId: "conv-1", role: "assistant", content: "¡Hola! Claro, te cuento.", createdAt: T_OUT_1 },
  { id: "m3", conversationId: "conv-1", role: "user", content: "¿Podemos agendar una llamada?", createdAt: T_IN_2 },
];

const MOCKED_CONVERSATIONS = [
  {
    id: "conv-1",
    channel: "telegram",
    createdAt: T_IN_1,
    agent: { name: "Ariadna" },
    lead: { customerName: "Clínica Norte S.L.", email: null, phone: "+34 600 111 222" },
    metadata: { telegramChatId: 123456 },
    messages: CONV1_MESSAGES,
  },
  {
    id: "conv-2",
    channel: "telegram",
    createdAt: T_IN_1,
    agent: { name: "Mateo" },
    lead: null,
    metadata: { externalId: "789012" },
    messages: [
      { id: "m4", conversationId: "conv-2", role: "user", content: "Buenas, ¿precios?", createdAt: T_IN_1 },
    ],
  },
];

const NEW_INCOMING = {
  id: "m5",
  conversationId: "conv-1",
  role: "user",
  content: "¿Sigue en pie la llamada de mañana?",
  createdAt: T_IN_NEW,
};

const CONVERSATIONS_URL = "**/api/channels/telegram/conversations";
const MESSAGES_URL = "**/api/channels/telegram/conversations/*/messages";
const OPERATOR_HISTORY_URL = "**/api/operator-chat/history*";
const OPERATOR_SEND_URL = "**/api/operator-chat/send";

// ── Historial mockeado del operador (misma forma que el proxy operator-chat) ─

const OP_T_USER = "2026-07-06T08:00:00.000Z";
const OP_T_ASSISTANT = "2026-07-06T08:00:30.000Z";

const OPERATOR_HISTORY = {
  messages: [
    { id: "op-1", role: "user", text: "¿Estado del despliegue?", createdAt: OP_T_USER },
    { id: "op-2", role: "assistant", text: "Todo en verde: 30/30 tests.", createdAt: OP_T_ASSISTANT },
  ],
};

/**
 * Prepara la página autenticada con mocks del canal:
 *  - catch-all /api/** → {} (sidebar /api/config, /api/auth/me, etc.),
 *  - lista de conversaciones y mensajes del hilo mockeados,
 *  - sesión falsa + intervalos de polling acelerados (override e2e).
 */
async function seedAuthenticatedApp(page: Page, supabaseUrl: string) {
  await page.route("**/api/**", (route) => fulfillJson(route, {}));
  await page.route(CONVERSATIONS_URL, (route) => fulfillJson(route, MOCKED_CONVERSATIONS));
  await page.route(MESSAGES_URL, (route) => fulfillJson(route, CONV1_MESSAGES));

  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
      // Acelerar el polling del widget (15s lista / 5s hilo en producción).
      window.localStorage.setItem("aa-telegram-poll-ms", "300");
    },
    [supabaseStorageKey(supabaseUrl), JSON.stringify(buildFakeSession())] as const,
  );
}

const supabaseUrl = resolveSupabaseUrl();

// El chip flotante SOLO existe con el panel cerrado (`TelegramWidget.tsx:271`): al abrir,
// el control de cierre pasa a ser la X de la cabecera del panel. Cerrar clicando el chip
// es imposible — el nodo ya no está en el DOM.
function cerrarPanel(page: Page) {
  return page.getByLabel("Cerrar panel de Telegram").click();
}

test.describe("Telegram floating widget", () => {
  test.skip(
    !supabaseUrl,
    "NEXT_PUBLIC_SUPABASE_URL is required to seed a Supabase session (front/.env.local)",
  );

  test("renders the chip on an authenticated app page and opens the panel with conversations", async ({ page }) => {
    await seedAuthenticatedApp(page, supabaseUrl!);
    await page.goto("/agenda");

    const chip = page.getByTestId("telegram-widget-chip");
    await expect(chip).toBeVisible();
    await expect(page.getByTestId("telegram-widget-panel")).toHaveCount(0);

    await chip.click();
    const panel = page.getByTestId("telegram-widget-panel");
    await expect(panel).toBeVisible();

    // La pestaña por defecto es «Operador»; las conversaciones viven en «Clientes».
    await expect(page.getByTestId("telegram-widget-tab-operator")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByTestId("telegram-widget-tab-clients").click();

    // Lista mockeada: nombre del lead o "Chat #<externalId>" como fallback.
    const list = page.getByTestId("telegram-widget-conversations");
    await expect(list.getByText("Clínica Norte S.L.")).toBeVisible();
    await expect(list.getByText("Chat #789012")).toBeVisible();
    await expect(list.getByText("¿Podemos agendar una llamada?")).toBeVisible();

    await cerrarPanel(page);
    await expect(panel).not.toBeVisible();
    // Con el panel cerrado el chip vuelve, listo para reabrir.
    await expect(chip).toBeVisible();
  });

  test("opens a conversation and renders the thread with in/out bubbles", async ({ page }) => {
    await seedAuthenticatedApp(page, supabaseUrl!);
    await page.goto("/agenda");

    await page.getByTestId("telegram-widget-chip").click();
    await page.getByTestId("telegram-widget-tab-clients").click();
    await page.getByTestId("telegram-widget-conversation").filter({ hasText: "Clínica Norte S.L." }).click();

    const thread = page.getByTestId("telegram-widget-thread");
    await expect(thread).toBeVisible();
    await expect(thread.getByText("Hola, quiero información de la agencia.")).toBeVisible();
    await expect(thread.getByText("¡Hola! Claro, te cuento.")).toBeVisible();

    // Entrantes a la izquierda, salientes a la derecha (data-direction).
    await expect(thread.locator('[data-direction="in"]')).toHaveCount(2);
    await expect(thread.locator('[data-direction="out"]')).toHaveCount(1);

    // Volver a la lista sin cerrar el panel.
    await page.getByRole("button", { name: "Volver a la lista" }).click();
    await expect(page.getByTestId("telegram-widget-conversations")).toBeVisible();
  });

  test("sends a message optimistically with clientMsgId and survives a mid-flight poll (mergeServerPage)", async ({ page }) => {
    await seedAuthenticatedApp(page, supabaseUrl!);

    // POST bloqueado hasta releaseSend(): permite asertar la inserción optimista
    // ("enviando...") mientras la request sigue en vuelo, sin carreras.
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => (releaseSend = resolve));
    let postedBody: { content?: string; clientMsgId?: string } | null = null;

    await page.route(MESSAGES_URL, async (route) => {
      const method = route.request().method();
      if (method === "OPTIONS") return route.fulfill({ status: 204, headers: CORS_HEADERS });
      if (method === "GET") return fulfillJson(route, CONV1_MESSAGES);
      // POST manual: el back persiste el mensaje con id = clientMsgId (idempotencia).
      postedBody = route.request().postDataJSON();
      await sendGate;
      return route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          id: postedBody?.clientMsgId,
          conversationId: "conv-1",
          role: "assistant",
          content: postedBody?.content,
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto("/agenda");
    await page.getByTestId("telegram-widget-chip").click();
    await page.getByTestId("telegram-widget-tab-clients").click();
    await page.getByTestId("telegram-widget-conversation").filter({ hasText: "Clínica Norte S.L." }).click();

    const thread = page.getByTestId("telegram-widget-thread");
    await expect(thread).toBeVisible();

    await page.getByTestId("telegram-widget-input").fill("Perfecto, te llamo a las 12:00.");
    await page.getByTestId("telegram-widget-send").click();

    // Inserción optimista: la burbuja aparece ANTES de que el back responda.
    const sentBubble = thread.locator('[data-direction="out"]').filter({ hasText: "Perfecto, te llamo a las 12:00." });
    await expect(sentBubble).toBeVisible();
    await expect(sentBubble.getByText(/enviando/)).toBeVisible();

    releaseSend();

    // Confirmado: desaparece la marca "enviando..." y el body llevó clientMsgId.
    await expect(sentBubble.getByText(/enviando/)).toHaveCount(0);
    // Snapshot ensanchado: TS estrecha postedBody a null porque la asignación vive
    // dentro del callback de page.route.
    const posted = postedBody as { content?: string; clientMsgId?: string } | null;
    expect(posted?.content).toBe("Perfecto, te llamo a las 12:00.");
    expect(posted?.clientMsgId).toMatch(/^manual-/);

    // mergeServerPage: el GET del hilo mockeado NO incluye el mensaje enviado; tras
    // varios ciclos de polling (300ms) el saliente local debe seguir en pantalla.
    await page.waitForTimeout(1200);
    await expect(sentBubble).toBeVisible();
  });

  test("shows the unread badge, clears it on read, and pulses when a new incoming message arrives", async ({ page }) => {
    await seedAuthenticatedApp(page, supabaseUrl!);
    await page.goto("/agenda");

    const chip = page.getByTestId("telegram-widget-chip");
    // Sin last-seen previo: 2 entrantes de conv-1 + 1 de conv-2 = 3 no leídos.
    await expect(page.getByTestId("telegram-widget-unread")).toHaveText("3");

    // Leer conv-1 → su last-seen se persiste y solo queda conv-2 sin leer.
    await chip.click();
    await page.getByTestId("telegram-widget-tab-clients").click();
    await page.getByTestId("telegram-widget-conversation").filter({ hasText: "Clínica Norte S.L." }).click();
    await expect(page.getByTestId("telegram-widget-thread")).toBeVisible();
    await cerrarPanel(page); // cerrar panel: el badge vuelve a ser visible en el chip
    await expect(page.getByTestId("telegram-widget-unread")).toHaveText("1");

    // Llega un entrante nuevo en conv-1 (poll de la lista, aun con panel cerrado):
    // el badge sube y el chip emite el pulso visual.
    await page.route(CONVERSATIONS_URL, (route) =>
      fulfillJson(route, [
        { ...MOCKED_CONVERSATIONS[0], messages: [...CONV1_MESSAGES, NEW_INCOMING] },
        MOCKED_CONVERSATIONS[1],
      ]),
    );
    await expect(page.getByTestId("telegram-widget-unread")).toHaveText("2");
    await expect(page.getByTestId("telegram-widget-pulse")).toBeVisible();
  });
});

test.describe("Operator tab (Minion 3A)", () => {
  test.skip(
    !supabaseUrl,
    "NEXT_PUBLIC_SUPABASE_URL is required to seed a Supabase session (front/.env.local)",
  );

  test("is the default tab and renders the proxied history with own/assistant bubbles", async ({ page }) => {
    await seedAuthenticatedApp(page, supabaseUrl!);
    await page.route(OPERATOR_HISTORY_URL, (route) => fulfillJson(route, OPERATOR_HISTORY));
    await page.goto("/agenda");

    await page.getByTestId("telegram-widget-chip").click();
    await expect(page.getByTestId("telegram-widget-tab-operator")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const thread = page.getByTestId("telegram-widget-thread");
    await expect(thread).toBeVisible();
    await expect(thread.getByText("¿Estado del despliegue?")).toBeVisible();
    await expect(thread.getByText("Todo en verde: 30/30 tests.")).toBeVisible();

    // En el hilo del operador el saliente (derecha/acento) es el mensaje PROPIO
    // (role "user"); la respuesta del agente (assistant) va a la izquierda.
    await expect(thread.locator('[data-direction="out"]')).toHaveCount(1);
    await expect(
      thread.locator('[data-direction="out"]').getByText("¿Estado del despliegue?"),
    ).toBeVisible();
    await expect(thread.locator('[data-direction="in"]')).toHaveCount(1);

    // Cambiar a «Clientes» conserva la UX existente y volver a «Operador» mantiene el hilo.
    await page.getByTestId("telegram-widget-tab-clients").click();
    await expect(page.getByTestId("telegram-widget-conversations")).toBeVisible();
    await expect(page.getByText("Clínica Norte S.L.")).toBeVisible();
    await page.getByTestId("telegram-widget-tab-operator").click();
    await expect(thread.getByText("¿Estado del despliegue?")).toBeVisible();
  });

  test("sends optimistically with clientMessageId and reconciles via a later history poll", async ({ page }) => {
    await seedAuthenticatedApp(page, supabaseUrl!);

    // El POST devuelve 202 sin id del gateway: el turno confirmado aparece en el
    // historial en un poll POSTERIOR (aquí, tras completarse el POST).
    let confirmed = false;
    await page.route(OPERATOR_HISTORY_URL, (route) =>
      fulfillJson(
        route,
        confirmed
          ? {
              messages: [
                ...OPERATOR_HISTORY.messages,
                { id: "op-3", role: "user", text: "Lanza el deploy de AA.", createdAt: new Date().toISOString() },
              ],
            }
          : OPERATOR_HISTORY,
      ),
    );

    // POST bloqueado hasta releaseSend(): permite asertar la inserción optimista
    // ("enviando...") mientras la request sigue en vuelo, sin carreras.
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => (releaseSend = resolve));
    let postedBody: { text?: string; clientMessageId?: string } | null = null;

    await page.route(OPERATOR_SEND_URL, async (route) => {
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: CORS_HEADERS });
      }
      postedBody = route.request().postDataJSON();
      await sendGate;
      confirmed = true;
      return route.fulfill({
        status: 202,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true, clientMessageId: postedBody?.clientMessageId }),
      });
    });

    await page.goto("/agenda");
    await page.getByTestId("telegram-widget-chip").click();
    const thread = page.getByTestId("telegram-widget-thread");
    await expect(thread).toBeVisible();

    await page.getByTestId("telegram-widget-input").fill("Lanza el deploy de AA.");
    await page.getByTestId("telegram-widget-send").click();

    // Inserción optimista: burbuja propia visible ANTES de que el proxy responda.
    const sentBubble = thread
      .locator('[data-direction="out"]')
      .filter({ hasText: "Lanza el deploy de AA." });
    await expect(sentBubble).toBeVisible();
    await expect(sentBubble.getByText(/enviando/)).toBeVisible();

    releaseSend();

    // Reconciliación: al llegar el turno "user" equivalente en el historial, la
    // burbuja optimista se retira y queda solo la confirmada (sin "enviando...").
    await expect(sentBubble.getByText(/enviando/)).toHaveCount(0);
    await expect(sentBubble).toBeVisible();

    // Snapshot ensanchado: TS estrecha postedBody a null porque la asignación vive
    // dentro del callback de page.route.
    const posted = postedBody as { text?: string; clientMessageId?: string } | null;
    expect(posted?.text).toBe("Lanza el deploy de AA.");
    expect(posted?.clientMessageId).toBeTruthy();
  });

  test("shows the unconfigured state on gateway 503 and keeps the clients tab working", async ({ page }) => {
    await seedAuthenticatedApp(page, supabaseUrl!);
    await page.route(OPERATOR_HISTORY_URL, (route) => {
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: CORS_HEADERS });
      }
      return route.fulfill({
        status: 503,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Gateway OpenClaw no configurado", code: "OPENCLAW_UNCONFIGURED" }),
      });
    });
    await page.goto("/agenda");

    await page.getByTestId("telegram-widget-chip").click();
    const unconfigured = page.getByTestId("telegram-widget-operator-unconfigured");
    await expect(unconfigured).toBeVisible();
    await expect(unconfigured.getByText("no configurado")).toBeVisible();

    // La pestaña «Clientes» sigue plenamente funcional (aislamiento del fallo).
    await page.getByTestId("telegram-widget-tab-clients").click();
    await page.getByTestId("telegram-widget-conversation").filter({ hasText: "Clínica Norte S.L." }).click();
    await expect(page.getByTestId("telegram-widget-thread")).toBeVisible();
    await expect(page.getByText("Hola, quiero información de la agencia.")).toBeVisible();
  });

  test("operator unread counts toward the chip badge and clears when the tab is read", async ({ page }) => {
    await seedAuthenticatedApp(page, supabaseUrl!);
    await page.route(OPERATOR_HISTORY_URL, (route) => fulfillJson(route, OPERATOR_HISTORY));
    await page.goto("/agenda");

    // 3 entrantes de clientes + 1 respuesta del operador sin leer = 4 en el chip.
    await expect(page.getByTestId("telegram-widget-unread")).toHaveText("4");

    // Abrir el panel (pestaña «Operador» por defecto) marca la respuesta como leída.
    const chip = page.getByTestId("telegram-widget-chip");
    await chip.click();
    await expect(page.getByTestId("telegram-widget-thread")).toBeVisible();
    await cerrarPanel(page); // cerrar: el badge vuelve al chip solo con los de clientes
    await expect(page.getByTestId("telegram-widget-unread")).toHaveText("3");
  });
});

test.describe("Telegram widget visibility on public pages", () => {
  test("the widget is absent on the public landing page", async ({ page }) => {
    // Sin sesión y en "/": ni chip ni panel (la landing queda limpia para el login).
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
    await expect(page.getByTestId("telegram-widget-chip")).toHaveCount(0);
    await expect(page.getByTestId("telegram-widget-panel")).toHaveCount(0);
  });
});
