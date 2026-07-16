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

    await page.getByRole("button", { name: "Siguiente" }).click();
    await expect(page.getByRole("button", { name: "Salud" })).toHaveClass(/border-\[var\(--neon-purple\)\]/);
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.getByRole("button", { name: "Siguiente" }).click();

    // F4 (aa-agent-backend-foundation): paso "Datos del negocio" obligatorio,
    // sin default silencioso — sin selección no se puede crear.
    await expect(page.getByRole("radiogroup", { name: "Datos del negocio" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Crear agente" })).toBeDisabled();
    await expect(
      page.getByText("Elige cómo gestiona los datos del negocio (o «Solo información»)")
    ).toBeVisible();

    await page.getByRole("radio", { name: "Solo información" }).check({ force: true });
    await page.getByRole("button", { name: "Crear agente" }).click();

    expect(submitBody).toMatchObject({
      runtime: "openclaw",
      tenantId: "tenant-existing",
      clientName: "Clinica Norte",
      sector: "salud",
      dataBackend: { mode: "none_yet" },
    });
    expect(submitBody).not.toHaveProperty("tenantId", undefined);
    // Skills oculto del wizard: no viaja skillIds en el payload.
    expect(submitBody).not.toHaveProperty("skillIds");
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
    await page.getByRole("radio", { name: "El agente gestiona datos" }).check({ force: true });
    await expect(page.getByRole("button", { name: "Crear agente" })).toBeDisabled();
    await expect(
      page.getByText("Elige al menos una capacidad: reservas, leads o pedidos")
    ).toBeVisible();

    await page.getByRole("checkbox", { name: "Reservas" }).check({ force: true });
    await page.getByRole("button", { name: "Crear agente" }).click();

    expect(submitBody).toMatchObject({
      dataBackend: { mode: "managed_db", capabilities: ["reservas"] },
    });
  });
});
