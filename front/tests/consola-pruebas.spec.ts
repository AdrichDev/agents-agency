import { expect, test, type Page, type Route } from "@playwright/test";

// e2e de la Consola de pruebas del agente (change `aa-agente-consola-pruebas`, F2).
// Cubre lo que T3.2 pedía mirar a ojo: banner de estado, desglose por turno
// (render especial de `search_knowledge` y aviso de error) y footer de
// latencia/tokens/modelo. Lo único que NO cubre —y por eso T3.2 sigue siendo
// gate humano— es que un agente REAL produzca esos datos; aquí `/api/chat` se
// mockea. Lo que se fija es que la UI los pinta cuando llegan.

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

const AGENT = {
  id: "ag-1",
  name: "Agente de prueba",
  channel: "widget",
  model: "gpt-5.4-mini",
  status: "draft",
  isActive: false,
  publicKey: "pk_test",
  integrations: [],
  // `getAgentDetail` (back/src/lib/agent/service.ts:539) incluye SIEMPRE `_count`;
  // omitirlo aquí no simula ninguna respuesta real y revienta la tab Conocimiento.
  _count: { knowledge: 0, conversations: 0, leads: 0 },
};

type Opciones = { chunks?: number; reply?: unknown };

async function abrirConsola(page: Page, opciones: Opciones = {}) {
  const { chunks = 12, reply } = opciones;

  await page.route("**/api/**", (route) => fulfillJson(route, {}));
  await page.route("**/api/agents/ag-1", (route) => fulfillJson(route, AGENT));
  await page.route("**/api/knowledge/ag-1/sources", (route) =>
    fulfillJson(route, {
      sources: chunks > 0 ? [{ source: "web.pdf", chunks }] : [],
    }),
  );
  if (reply !== undefined) {
    await page.route("**/api/chat", (route) => fulfillJson(route, reply));
  }

  await page.goto("/agents/ag-1?tab=chat");
  await expect(page.getByPlaceholder("Escribe como si fueras el cliente…")).toBeVisible();
}

function enviar(page: Page, texto: string) {
  return page.getByPlaceholder("Escribe como si fueras el cliente…").fill(texto).then(() =>
    page.getByRole("button", { name: "Enviar" }).click(),
  );
}

test.describe("Consola de pruebas del agente", () => {
  test("banner verde con conocimiento indexado: canal, fragmentos y modelo", async ({ page }) => {
    await abrirConsola(page, { chunks: 12 });

    const banner = page.getByText("🟢 Listo para probar").locator("..");
    await expect(banner).toContainText("Canal: Widget web");
    await expect(banner).toContainText("12 fragmentos indexados");
    await expect(banner).toContainText("Modelo: gpt-5.4-mini");
  });

  test("banner ámbar sin conocimiento y enlace a la pestaña Conocimiento", async ({ page }) => {
    await abrirConsola(page, { chunks: 0 });

    await expect(page.getByText("🟡 Aún sin conocimiento")).toBeVisible();
    await expect(page.getByText("El agente no sabrá nada del negocio.")).toBeVisible();

    // El aviso lleva de verdad a la pestaña, no es decorativo.
    await page.getByRole("button", { name: "Ir a la pestaña Conocimiento" }).click();
    await expect(page.getByPlaceholder("Escribe como si fueras el cliente…")).toHaveCount(0);
    await expect(page.getByText(/chunks indexados/)).toBeVisible();
  });

  test("un turno pinta desglose colapsado, chunks con % y footer de latencia/tokens/modelo", async ({ page }) => {
    await abrirConsola(page, {
      reply: {
        text: "Abrimos de 9 a 20.",
        conversationId: "conv-1",
        tokensUsed: 482,
        model: "gpt-5.4-mini",
        latencyMs: 1350,
        toolCalls: [
          {
            tool: "search_knowledge",
            input: { query: "horario" },
            output: [{ source: "web.pdf", content: "Horario: de 9 a 20 h de lunes a viernes.", distance: 0.13 }],
          },
        ],
      },
    });

    await enviar(page, "¿Qué horario tenéis?");
    await expect(page.getByText("Abrimos de 9 a 20.")).toBeVisible();

    // Footer del turno: latencia en segundos, tokens y modelo.
    await expect(page.getByText(/⚡ 1\.4 s · 482 tokens · gpt-5\.4-mini/)).toBeVisible();

    // El desglose nace colapsado; el detalle sólo aparece al desplegarlo.
    const desglose = page.getByRole("button", { name: /Ver qué hizo el agente \(1 acción\)/ });
    await expect(desglose).toBeVisible();
    await expect(page.getByText("Consultó su conocimiento")).toHaveCount(0);

    await desglose.click();
    await expect(page.getByText("🔍 Consultó su conocimiento")).toBeVisible();
    await expect(page.getByText('Búsqueda: "horario"')).toBeVisible();
    // distance 0.13 → 87 % de similitud, y el snippet de la fuente, no el JSON crudo.
    await expect(page.getByText(/web\.pdf — "Horario: de 9 a 20 h de lunes a viernes\." \(87%\)/)).toBeVisible();
  });

  test("una herramienta que falla se avisa en lenguaje llano, sin volcar el error crudo suelto", async ({ page }) => {
    await abrirConsola(page, {
      reply: {
        text: "No he podido reservar.",
        toolCalls: [{ tool: "crear_reserva", input: { hora: "10:00" }, output: null, error: "slot ocupado" }],
        tokensUsed: 120,
        latencyMs: 800,
      },
    });

    await enviar(page, "Resérvame a las 10");
    await page.getByRole("button", { name: /Ver qué hizo el agente/ }).click();

    await expect(page.getByText("📅 Creó una reserva")).toBeVisible();
    await expect(page.getByText("⚠️ No pudo completar la acción: slot ocupado")).toBeVisible();
  });

  test("Reiniciar vacía la conversación y vuelve al estado inicial", async ({ page }) => {
    await abrirConsola(page, { reply: { text: "Hola", tokensUsed: 10, latencyMs: 500 } });

    await enviar(page, "hola");
    await expect(page.getByText("Hola", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Reiniciar" }).click();
    await expect(page.getByText("Hola", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("Háblale a tu agente como lo haría un cliente real para ver cómo responde antes de publicarlo."),
    ).toBeVisible();
  });

  test("la consola manda test:true para no ensuciar la analítica del cliente", async ({ page }) => {
    let cuerpo: any = null;
    await page.route("**/api/**", (route) => fulfillJson(route, {}));
    await page.route("**/api/agents/ag-1", (route) => fulfillJson(route, AGENT));
    await page.route("**/api/knowledge/ag-1/sources", (route) =>
      fulfillJson(route, { sources: [{ source: "web.pdf", chunks: 3 }] }),
    );
    await page.route("**/api/chat", (route) => {
      cuerpo = JSON.parse(route.request().postData() ?? "{}");
      return fulfillJson(route, { text: "ok" });
    });

    await page.goto("/agents/ag-1?tab=chat");
    await enviar(page, "prueba");
    await expect(page.getByText("ok", { exact: true })).toBeVisible();

    expect(cuerpo).toMatchObject({ agentId: "ag-1", message: "prueba", test: true });
  });
});
