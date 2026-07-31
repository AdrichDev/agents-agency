import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * aa-canales-buffer-y-respuesta-partida — T5 (configuración en el panel) desde el navegador.
 *
 * La tabla de `validation.md` dejaba T5 con «verificación visual del panel» y sin fichero de
 * test. Una verificación visual no es reproducible y caduca en silencio en cuanto alguien
 * toca el JSX: los tres controles pueden desaparecer, dejar de mandarse en el PATCH o
 * mandarse como texto en vez de número, y la suite seguiría verde. Esto lo cubre.
 *
 * Lo que se comprueba es el contrato del panel, no la lógica del buffer (eso vive en
 * `back/tests/inbound-buffer.test.ts` y `reply-split.test.ts`):
 *  - los tres controles existen y nacen en el valor que trae el agente,
 *  - la pausa entre mensajes SOLO aparece cuando la respuesta se parte (render condicional),
 *  - el PATCH lleva los tres campos como números.
 *
 * Backend mockeado a propósito: aquí se prueba que el front pinta y manda lo que toca.
 */

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

/** Mismo patrón que `agents-onboarding.spec.ts`: clave donde supabase-js persiste la sesión. */
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

function buildFakeSession() {
  const nowSec = Math.floor(Date.now() / 1000);
  const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    sub: "e2e-rhythm-user",
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
      id: "e2e-rhythm-user",
      aud: "authenticated",
      role: "authenticated",
      email: "e2e-rhythm@test.local",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    },
  };
}

const AGENT_URL = "**/api/agents/ag-rhythm";

/** Agente tal y como lo sirve `GET /api/agents/:id`, con los defaults de AD2 (ritmo apagado). */
function agente(overrides: Record<string, unknown> = {}) {
  return {
    id: "ag-rhythm",
    name: "Ariadna",
    sector: "salud",
    status: "draft",
    model: "gpt-5.4-mini",
    runtime: "openai",
    channel: "widget",
    systemPrompt: "Eres Ariadna.",
    temperature: 0.7,
    inboundBufferMs: 0,
    replyMaxMessages: 1,
    replySplitPauseMs: 0,
    integrations: [],
    _count: { conversations: 0, automations: 0, knowledge: 0, leads: 0 },
    ...overrides,
  };
}

/**
 * Deja la pestaña «Ajustes» abierta. Devuelve la caja donde se guarda el cuerpo del PATCH:
 * TS no puede estrechar una asignación hecha dentro del callback de `page.route`, así que
 * viaja envuelta.
 */
async function abrirAjustes(page: Page, supabaseUrl: string, agent: Record<string, unknown>) {
  const patch: { body: Record<string, unknown> | null } = { body: null };

  await page.route("**/api/**", (route) => fulfillJson(route, {}));
  await page.route("**/api/knowledge/**", (route) => fulfillJson(route, { sources: [] }));
  await page.route(AGENT_URL, (route) => {
    if (route.request().method() === "PATCH") {
      patch.body = JSON.parse(route.request().postData() ?? "{}");
      return fulfillJson(route, { ...agent, ...patch.body });
    }
    return fulfillJson(route, agent);
  });

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [
      `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
      JSON.stringify(buildFakeSession()),
    ] as const,
  );

  await page.goto("/agents/ag-rhythm?tab=ajustes");
  return patch;
}

const supabaseUrl = resolveSupabaseUrl();

test.describe("Ritmo de conversación en la ficha del agente (T5)", () => {
  test.skip(
    !supabaseUrl,
    "NEXT_PUBLIC_SUPABASE_URL is required to seed a Supabase session (front/.env.local)",
  );

  test("los tres controles nacen en los defaults y la pausa solo aparece al partir (T5.1)", async ({
    page,
  }) => {
    await abrirAjustes(page, supabaseUrl!, agente());

    const buffer = page.getByTestId("agent-rhythm-buffer");
    const split = page.getByTestId("agent-rhythm-split");

    await expect(buffer).toBeVisible();
    await expect(split).toBeVisible();
    // Defaults de AD2: sin agrupar, sin partir.
    await expect(buffer).toHaveValue("0");
    await expect(split).toHaveValue("1");

    // Render condicional: la pausa no tiene sentido con un solo mensaje y no debe estar.
    await expect(page.getByTestId("agent-rhythm-pause")).toHaveCount(0);

    await split.selectOption("2");
    await expect(page.getByTestId("agent-rhythm-pause")).toBeVisible();
    await expect(page.getByTestId("agent-rhythm-pause")).toHaveValue("0");

    // Y desaparece al volver a un solo mensaje.
    await split.selectOption("1");
    await expect(page.getByTestId("agent-rhythm-pause")).toHaveCount(0);
  });

  test("los controles reflejan el valor guardado del agente, no el default (T5.1)", async ({
    page,
  }) => {
    await abrirAjustes(
      page,
      supabaseUrl!,
      agente({ inboundBufferMs: 5000, replyMaxMessages: 3, replySplitPauseMs: 2000 }),
    );

    await expect(page.getByTestId("agent-rhythm-buffer")).toHaveValue("5000");
    await expect(page.getByTestId("agent-rhythm-split")).toHaveValue("3");
    // Con la respuesta partida, la pausa guardada sí se pinta.
    await expect(page.getByTestId("agent-rhythm-pause")).toHaveValue("2000");
  });

  test("guardar manda los tres campos como números en el PATCH (T5.2)", async ({ page }) => {
    const patch = await abrirAjustes(page, supabaseUrl!, agente());

    await page.getByTestId("agent-rhythm-buffer").selectOption("10000");
    await page.getByTestId("agent-rhythm-split").selectOption("2");
    await page.getByTestId("agent-rhythm-pause").selectOption("1000");

    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("✓ Guardado")).toBeVisible();

    // El `<select>` devuelve string: si el panel dejara de hacer Number(), el back recibiría
    // "10000" y la validación de rangos (T5.2) no vería un número. Por eso se compara
    // estricto contra el valor numérico.
    expect(patch.body?.inboundBufferMs).toBe(10000);
    expect(patch.body?.replyMaxMessages).toBe(2);
    expect(patch.body?.replySplitPauseMs).toBe(1000);
  });

  test("sin tocar nada el botón Guardar está deshabilitado (no manda PATCH vacío)", async ({
    page,
  }) => {
    const patch = await abrirAjustes(page, supabaseUrl!, agente());

    await expect(page.getByTestId("agent-rhythm-buffer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(patch.body).toBeNull();
  });
});
