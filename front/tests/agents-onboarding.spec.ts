import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * aa-puesta-en-marcha-agente — AC7 y AC8 desde el navegador.
 *
 * Los dos criterios hablan de lo que ve el operador, no de lo que devuelve una ruta: AC7 es
 * un contador en el listado y AC8 es el escalón pendiente en la ficha. Un test de backend no
 * los demuestra, y declararlos cumplidos leyendo el JSX tampoco.
 *
 * El backend va mockeado a propósito: lo que se comprueba aquí es que el front PINTA lo que
 * llega, no que lo calcule. AC7 lo dice explícitamente — el front cuenta, no reimplementa el
 * criterio. Por eso las respuestas traen `onboarding` ya resuelto.
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

/** Mismo patrón que `agenda.spec.ts`: la clave donde supabase-js persiste la sesión. */
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
    sub: "e2e-onboarding-user",
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
      id: "e2e-onboarding-user",
      aud: "authenticated",
      role: "authenticated",
      email: "e2e-onboarding@test.local",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    },
  };
}

async function seedSession(page: Page) {
  const supabaseUrl = resolveSupabaseUrl();
  test.skip(!supabaseUrl, "Sin NEXT_PUBLIC_SUPABASE_URL no se puede sembrar la sesión.");
  const key = `sb-${new URL(supabaseUrl!).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [key, JSON.stringify(buildFakeSession())] as const,
  );
}

/** Un agente del listado con su `onboarding` tal y como lo sirve `GET /api/agents`. */
function agente(
  id: string,
  name: string,
  escalones: { configurado: boolean; publicado: boolean; alcanzable: boolean; probado: boolean },
  next: { step: string | null; nextLabel: string | null; nextTab: string | null },
) {
  return {
    id,
    name,
    sector: "salud",
    status: escalones.publicado ? "published" : "draft",
    model: "gpt-5.4-mini",
    runtime: "openclaw",
    channel: "widget",
    // La tarjeta hace `a.integrations.map(...)` sin guarda: sin este campo la página entera
    // revienta con un error de cliente y el test verde no probaría nada.
    integrations: [],
    // Idem con el contador de chats de la tarjeta: `a._count.conversations` sin guarda.
    _count: { conversations: 0, automations: 0, knowledge: 0, leads: 0 },
    onboarding: { ...escalones, ...next },
  };
}

test.describe("AC7 — el listado dice cuántos agentes no atienden a nadie", () => {
  test("tres agentes, dos sin alcance: el aviso dice 2 y enlaza al primero", async ({ page }) => {
    await seedSession(page);
    await page.route("**/api/**", (route) => fulfillJson(route, []));
    await page.route("**/api/agents**", (route) =>
      fulfillJson(route, [
        // Probado: atiende y ha recibido tráfico. No cuenta.
        agente(
          "ag-ok",
          "Agente Rodado",
          { configurado: true, publicado: true, alcanzable: true, probado: true },
          { step: null, nextLabel: null, nextTab: null },
        ),
        // Publicado pero sin widget ni canal: factura y no atiende. Cuenta.
        agente(
          "ag-sin-alcance",
          "Agente Sin Alcance",
          { configurado: true, publicado: true, alcanzable: false, probado: false },
          { step: "alcanzable", nextLabel: "Instalar el widget", nextTab: "implementacion" },
        ),
        // Borrador. Cuenta.
        agente(
          "ag-borrador",
          "Agente Borrador",
          { configurado: true, publicado: false, alcanzable: false, probado: false },
          { step: "publicado", nextLabel: "Publicar el agente", nextTab: "implementacion" },
        ),
      ]),
    );

    await page.goto("/agents");

    // El número sale de los booleanos del backend. Si el front recalculara el criterio,
    // este es el test que empezaría a discrepar con `agent-onboarding-state.test.ts`.
    await expect(page.getByText("2 agentes no atienden a nadie.")).toBeVisible();
    // Y ofrece por dónde empezar: un contador sin salida no arregla nada.
    await expect(page.getByRole("link", { name: /Empezar por Agente Sin Alcance/ })).toHaveAttribute(
      "href",
      "/agents/ag-sin-alcance",
    );
  });

  test("con todos los agentes alcanzables el aviso no aparece", async ({ page }) => {
    await seedSession(page);
    await page.route("**/api/**", (route) => fulfillJson(route, []));
    await page.route("**/api/agents**", (route) =>
      fulfillJson(route, [
        agente(
          "ag-ok",
          "Agente Rodado",
          { configurado: true, publicado: true, alcanzable: true, probado: true },
          { step: null, nextLabel: null, nextTab: null },
        ),
      ]),
    );

    await page.goto("/agents");

    await expect(page.getByText("Agente Rodado")).toBeVisible();
    await expect(page.getByText(/no atiende[n]? a nadie/)).toHaveCount(0);
  });

  test("un agente sin `onboarding` no se cuenta: mejor callar que inventarse el número", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/api/**", (route) => fulfillJson(route, []));
    await page.route("**/api/agents**", (route) =>
      fulfillJson(route, [
        {
          id: "ag-viejo",
          name: "Agente Sin Campo",
          sector: "salud",
          status: "draft",
          channel: "widget",
          integrations: [],
          _count: { conversations: 0, automations: 0, knowledge: 0, leads: 0 },
        },
      ]),
    );

    await page.goto("/agents");

    await expect(page.getByText("Agente Sin Campo")).toBeVisible();
    await expect(page.getByText(/no atiende[n]? a nadie/)).toHaveCount(0);
  });
});

test.describe("AC8 — la ficha dice el siguiente escalón y da UNA acción", () => {
  /** Detalle de agente con el `onboarding` que sirve `GET /api/agents/:id`. */
  function detalle(escalones: Record<string, boolean>, next: Record<string, string | null>) {
    return {
      id: "ag-1",
      name: "Agente Ficha",
      sector: "salud",
      status: escalones.publicado ? "published" : "draft",
      model: "gpt-5.4-mini",
      runtime: "openclaw",
      channel: "widget",
      systemPrompt: "Eres un agente.",
      tenantId: "tenant-1",
      integrations: [],
      publishPreconditions: { blocking: [], warnings: [] },
      onboarding: { ...escalones, ...next },
    };
  }

  test("borrador: los cuatro escalones, y la acción es publicar", async ({ page }) => {
    await seedSession(page);
    await page.route("**/api/**", (route) => fulfillJson(route, []));
    // `DeployPanel` hace `channels?.connections.find(...)`: el `?.` cubre el null, no un
    // objeto sin `connections`. Con `[]` la ficha entera se cae.
    await page.route("**/api/channels/**", (route) =>
      fulfillJson(route, { publicUrlConfigured: true, connections: [] }),
    );
    await page.route("**/api/agents/ag-1", (route) =>
      fulfillJson(
        route,
        detalle(
          { configurado: true, publicado: false, alcanzable: false, probado: false },
          { step: "publicado", nextLabel: "Publicar el agente", nextTab: "implementacion" },
        ),
      ),
    );

    await page.goto("/agents/ag-1?tab=implementacion");

    await expect(page.getByText("PUESTA EN MARCHA")).toBeVisible();
    // El escalón se pinta como «Etiqueta. Explicación» en un solo texto, así que se busca
    // por su explicación: es lo que distingue un escalón de la palabra suelta en otra parte
    // de la ficha (el chip de estado también dice «Borrador» y «Publicar»).
    for (const hint of [
      "Tiene cliente asignado y personalidad.",
      "Atiende al público y entra en la facturación.",
      "El widget está instalado o hay un canal conectado.",
      "Alguien de fuera le ha escrito ya.",
    ]) {
      await expect(page.getByText(hint, { exact: false }).first()).toBeVisible();
    }
    // T5.2: el copy es «ha recibido tráfico», nunca «lo usó un cliente». Lo único que
    // sabemos es que hubo una conversación fuera de la consola de pruebas.
    await expect(page.getByText(/lo (ha )?us[óo] un cliente/i)).toHaveCount(0);
    // La acción se pinta como texto, no como botón, cuando vive en la pestaña en la que ya
    // estás: el botón de la panel («Publicar») es el que la ejecuta. Un segundo botón que
    // llevara a la misma pestaña sería un callejón sin salida.
    await expect(page.getByText("Publicar el agente")).toBeVisible();
    // Sin salto de pestaña: los dos botones del panel («Ir a Ajustes», «Ir a Canales») sólo
    // aparecen cuando la acción vive en otra parte. Ojo: la ficha tiene además un «Ir a
    // publicarlo →» propio del banner de borrador, que no es este panel.
    await expect(page.getByRole("button", { name: /^Ir a (Ajustes|Canales)/ })).toHaveCount(0);
  });

  test("publicado sin alcance: la acción pasa a ser instalar el widget", async ({ page }) => {
    await seedSession(page);
    await page.route("**/api/**", (route) => fulfillJson(route, []));
    // `DeployPanel` hace `channels?.connections.find(...)`: el `?.` cubre el null, no un
    // objeto sin `connections`. Con `[]` la ficha entera se cae.
    await page.route("**/api/channels/**", (route) =>
      fulfillJson(route, { publicUrlConfigured: true, connections: [] }),
    );
    await page.route("**/api/agents/ag-1", (route) =>
      fulfillJson(
        route,
        detalle(
          { configurado: true, publicado: true, alcanzable: false, probado: false },
          { step: "alcanzable", nextLabel: "Instalar el widget", nextTab: "implementacion" },
        ),
      ),
    );

    await page.goto("/agents/ag-1?tab=implementacion");

    await expect(page.getByText("Instalar el widget")).toBeVisible();
    // UNA acción, no cuatro: ofrecerlas todas a la vez es lo que dejó diez agentes parados.
    // El escalón ya superado no vuelve a proponerse.
    await expect(page.getByText("Publicar el agente")).toHaveCount(0);
  });

  test("cuando la acción vive en otra pestaña, hay botón para ir", async ({ page }) => {
    await seedSession(page);
    await page.route("**/api/**", (route) => fulfillJson(route, []));
    await page.route("**/api/channels/**", (route) =>
      fulfillJson(route, { publicUrlConfigured: true, connections: [] }),
    );
    await page.route("**/api/agents/ag-1", (route) =>
      fulfillJson(
        route,
        detalle(
          { configurado: false, publicado: false, alcanzable: false, probado: false },
          { step: "configurado", nextLabel: "Asignar un cliente", nextTab: "ajustes" },
        ),
      ),
    );

    await page.goto("/agents/ag-1?tab=implementacion");

    // Aquí sí hace falta el botón: lo que hay que resolver no está en esta pantalla, y
    // AC8 exige una acción concreta, no un aviso que te deje buscándola.
    await expect(page.getByText("Asignar un cliente")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ir a Ajustes →" })).toBeVisible();
  });

  test("todo hecho: ni escalón pendiente ni acción", async ({ page }) => {
    await seedSession(page);
    await page.route("**/api/**", (route) => fulfillJson(route, []));
    // `DeployPanel` hace `channels?.connections.find(...)`: el `?.` cubre el null, no un
    // objeto sin `connections`. Con `[]` la ficha entera se cae.
    await page.route("**/api/channels/**", (route) =>
      fulfillJson(route, { publicUrlConfigured: true, connections: [] }),
    );
    await page.route("**/api/agents/ag-1", (route) =>
      fulfillJson(
        route,
        detalle(
          { configurado: true, publicado: true, alcanzable: true, probado: true },
          { step: null, nextLabel: null, nextTab: null },
        ),
      ),
    );

    await page.goto("/agents/ag-1?tab=implementacion");

    await expect(page.getByText("PUESTA EN MARCHA")).toBeVisible();
    await expect(page.getByText("Alguien de fuera le ha escrito ya.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Publicar el agente|Instalar el widget/ })).toHaveCount(0);
  });
});
