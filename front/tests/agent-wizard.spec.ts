import { expect, test, type Route } from "@playwright/test";

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

test.describe("OpenClaw agent wizard", () => {
  test("loads existing clients in step 1, autofills sector, and submits runtime=openclaw with tenantId", async ({ page }) => {
    let submitBody: any = null;

    await page.route("**/api/**", (route) => fulfillJson(route, {}));
    await page.route("**/api/clients", (route) =>
      fulfillJson(route, [
        {
          id: "tenant-existing",
          name: "Clinica Norte",
          sector: "salud",
          website: "https://clinicanorte.example",
        },
      ]),
    );
    await page.route("**/api/sectors**", (route) => fulfillJson(route, { items: ["salud", "Otro"], page: 1, totalPages: 1 }));
    await page.route("**/api/prompt/improve", (route) => fulfillJson(route, { prompt: "Prompt mejorado" }));
    await page.route("**/api/agents", async (route) => {
      submitBody = JSON.parse(route.request().postData() ?? "{}");
      return fulfillJson(route, { id: "agent-1" });
    });
    await page.goto("/agents/new");

    await expect(page.getByLabel("Nombre comercial del cliente")).toBeVisible();
    await page.getByLabel("Nombre comercial del cliente").selectOption("tenant-existing");
    await expect(page.getByPlaceholder("Web del cliente - https://...")).toHaveValue("https://clinicanorte.example");

    // El sector se autorrellena desde el tenant elegido y vive en el paso 1
    // ("Cliente y sector"), así que se comprueba ANTES de avanzar. El paso 2 es
    // "Canal", donde este botón ya no existe.
    await expect(page.getByRole("button", { name: "Salud" })).toHaveClass(/border-\[var\(--neon-purple\)\]/);
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.getByRole("button", { name: "Siguiente" }).click();

    // F4 (aa-agent-backend-foundation): paso "Datos del negocio" obligatorio,
    // sin default silencioso — sin selección no se puede crear.
    await expect(page.getByRole("radiogroup", { name: "Datos del negocio" })).toBeVisible();
    // aa-puesta-en-marcha-agente (T3.1): el botón único «Crear agente» ya no existe. Ahora
    // son dos acciones, y la de borrador es la que conserva el comportamiento de antes:
    // sólo `POST /api/agents`, sin publicar.
    await expect(page.getByRole("button", { name: "Crear como borrador" })).toBeDisabled();
    await expect(
      page.getByText("Elige cómo gestiona los datos del negocio (o «Solo información»)")
    ).toBeVisible();

    // Los radios/checkboxes de este paso son `sr-only` (1×1 px) dentro de un `<label>`:
    // el usuario clica la tarjeta, no el input. Forzar el click sobre el input no cambia
    // su estado porque el punto que se pulsa no le pertenece — se clica el label padre.
    await page.getByRole("radio", { name: "Solo información" }).locator("xpath=..").click();
    await page.getByRole("button", { name: "Crear como borrador" }).click();

    expect(submitBody).toMatchObject({
      runtime: "openclaw",
      tenantId: "tenant-existing",
      clientName: "Clinica Norte",
      sector: "salud",
      dataBackend: { mode: "none_yet" },
    });
    expect(submitBody).not.toHaveProperty("tenantId", undefined);
    // Skills oculto del wizard: no se asigna ninguna. Se comprueba la intención, no la forma
    // del payload: el schema del backend declara `skillIds: z.array(...).default([])`
    // (`back/src/routes/agents.ts`), así que enviar `[]` y omitir el campo son el mismo caso —
    // en ambos se crean cero skills. Enviarlo explícito es además lo que ya hace
    // `back/src/routes/service-operator.ts` al crear un agente suelto.
    expect(submitBody.skillIds ?? []).toEqual([]);
  });

  test("managed_db requiere al menos una capacidad y la envia en dataBackend", async ({ page }) => {
    let submitBody: any = null;

    await page.route("**/api/**", (route) => fulfillJson(route, {}));
    await page.route("**/api/clients", (route) => fulfillJson(route, []));
    await page.route("**/api/sectors**", (route) => fulfillJson(route, { items: ["salud", "Otro"], page: 1, totalPages: 1 }));
    await page.route("**/api/prompt/improve", (route) => fulfillJson(route, { prompt: "Prompt mejorado" }));
    await page.route("**/api/agents", async (route) => {
      submitBody = JSON.parse(route.request().postData() ?? "{}");
      return fulfillJson(route, { id: "agent-2" });
    });
    await page.goto("/agents/new");

    await page.getByLabel("Nombre comercial del cliente").selectOption("__new__");
    await page.getByPlaceholder("Nombre comercial (p.ej. Clínica Dental Sonrisa)").fill("Clinica Sur");
    await page.getByRole("button", { name: "Salud" }).click();
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.getByRole("button", { name: "Siguiente" }).click();

    // Elegir managed_db sin capacidades bloquea la creación con mensaje claro.
    await page.getByRole("radio", { name: "El agente gestiona datos" }).locator("xpath=..").click();
    await expect(page.getByRole("button", { name: "Crear como borrador" })).toBeDisabled();
    await expect(
      page.getByText("Elige al menos una capacidad: reservas, leads o pedidos")
    ).toBeVisible();

    await page.getByRole("checkbox", { name: "Reservas" }).locator("xpath=..").click();
    await page.getByRole("button", { name: "Crear como borrador" }).click();

    expect(submitBody).toMatchObject({
      dataBackend: { mode: "managed_db", capabilities: ["reservas"] },
    });
  });
});

/**
 * aa-puesta-en-marcha-agente — AC5 y AC6 desde el navegador.
 *
 * El backend ya está cubierto (`back/tests/agent-publish-routes.test.ts`), pero AC5 habla de
 * lo que ve el operador en el wizard y eso no se demuestra con un test de ruta. En producción
 * 10 de 11 agentes se quedaron en borrador precisamente porque la acción de publicar no
 * estaba delante: comprobar que ahora lo está es el punto del change.
 */
test.describe("Wizard — las dos acciones finales", () => {
  /** Rellena el wizard hasta el último paso. Devuelve la página lista para pulsar. */
  async function alUltimoPaso(page: import("@playwright/test").Page, conCliente: boolean) {
    await page.route("**/api/**", (route) => fulfillJson(route, {}));
    await page.route("**/api/clients", (route) =>
      fulfillJson(route, [{ id: "tenant-1", name: "Clinica Norte", sector: "salud" }]),
    );
    await page.route("**/api/sectors**", (route) =>
      fulfillJson(route, { items: ["salud", "Otro"], page: 1, totalPages: 1 }),
    );
    await page.goto("/agents/new");

    if (conCliente) {
      await page.getByLabel("Nombre comercial del cliente").selectOption("tenant-1");
    } else {
      // Sin tocar el desplegable: ni cliente existente ni cliente nuevo. El paso 1 deja
      // pasar, y ese es justo el agente que nace impublicable.
      await page.getByRole("button", { name: "Salud" }).click();
    }
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.getByRole("radio", { name: "Solo información" }).locator("xpath=..").click();
  }

  test("AC5 — con cliente, las dos acciones están y publicar avisa de la facturación", async ({
    page,
  }) => {
    await alUltimoPaso(page, true);

    const borrador = page.getByRole("button", { name: "Crear como borrador" });
    const publicar = page.getByRole("button", { name: "Crear y publicar" });
    await expect(borrador).toBeEnabled();
    await expect(publicar).toBeEnabled();

    // AC5 pide que las dos acciones sean explícitas, no que haya dos botones. Publicar mete
    // al agente en la factura del cliente: si eso no se dice, la acción es una trampa.
    await expect(page.getByText(/facturación del cliente/i)).toBeVisible();
  });

  test("GWT2 — sin cliente no se puede publicar, y se dice por qué (AC5)", async ({ page }) => {
    await alUltimoPaso(page, false);

    await expect(page.getByRole("button", { name: "Crear y publicar" })).toBeDisabled();
    await expect(page.getByText(/Sin cliente asignado no se puede publicar/i)).toBeVisible();
    // Y la salida sigue existiendo: crear el borrador nunca se bloquea por esto.
    await expect(page.getByRole("button", { name: "Crear como borrador" })).toBeEnabled();
  });

  test("AC6 — «Crear y publicar» llama a la ruta de publicación, no a un atajo", async ({
    page,
  }) => {
    const llamadas: string[] = [];
    await page.route("**/api/**", (route) => fulfillJson(route, {}));
    await page.route("**/api/clients", (route) =>
      fulfillJson(route, [{ id: "tenant-1", name: "Clinica Norte", sector: "salud" }]),
    );
    await page.route("**/api/sectors**", (route) =>
      fulfillJson(route, { items: ["salud", "Otro"], page: 1, totalPages: 1 }),
    );
    let altaBody: any = null;
    await page.route("**/api/agents", (route) => {
      llamadas.push("POST /api/agents");
      altaBody = JSON.parse(route.request().postData() ?? "{}");
      return fulfillJson(route, { id: "agent-9" });
    });
    await page.route("**/api/agents/agent-9/publish", (route) => {
      llamadas.push("POST /api/agents/agent-9/publish");
      return fulfillJson(route, { id: "agent-9", status: "published" });
    });

    await page.goto("/agents/new");
    await page.getByLabel("Nombre comercial del cliente").selectOption("tenant-1");
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.getByRole("radio", { name: "Solo información" }).locator("xpath=..").click();
    await page.getByRole("button", { name: "Crear y publicar" }).click();

    await expect.poll(() => llamadas).toEqual([
      "POST /api/agents",
      "POST /api/agents/agent-9/publish",
    ]);
    // El alta NO lleva un `status` ni un `publish` que mueva el estado por su cuenta: la
    // transición la escribe `transitionAgentStatus`, y tiene que seguir habiendo un solo
    // sitio que lo haga para que la auditoría de facturación cuadre.
    expect(altaBody.status).toBeUndefined();
    expect(altaBody.publish).toBeUndefined();
  });
});
