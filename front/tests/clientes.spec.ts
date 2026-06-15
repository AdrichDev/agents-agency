import { expect, type Page, type Route, test } from "@playwright/test";
import { mockShell } from "./helpers";

interface MockClient {
  id: string;
  codCliente: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  direccion: string | null;
  address: string | null;
  hasInvoices: boolean;
  createdAt: string;
}

function makeClient(over: Partial<MockClient> = {}): MockClient {
  return {
    id: "cl" + Math.random().toString(36).slice(2, 9),
    codCliente: "cli-00",
    name: "Cliente",
    contactPerson: null,
    phone: null,
    email: null,
    direccion: null,
    address: null,
    hasInvoices: false,
    createdAt: "2026-01-01T10:00:00.000Z",
    ...over,
  };
}

async function mockClients(page: Page, clients: MockClient[]) {
  await page.route("**/api/clients**", async (route: Route) => {
    const method = route.request().method();
    if (method === "DELETE") return route.fulfill({ json: { ok: true } });
    if (method === "POST") return route.fulfill({ status: 201, json: makeClient({ name: "Nuevo" }) });
    if (method === "PUT") return route.fulfill({ json: clients[0] });
    return route.fulfill({ json: clients });
  });
}

test("renders the clients table", async ({ page }) => {
  await mockShell(page);
  await mockClients(page, [
    makeClient({ id: "cl1", codCliente: "cli-01", name: "Acme SL", email: "info@acme.com" }),
    makeClient({ id: "cl2", codCliente: "cli-02", name: "Globex" }),
  ]);
  await page.goto("/clientes");

  await expect(page.getByText("Acme SL")).toBeVisible();
  await expect(page.getByText("Globex")).toBeVisible();
});

test("opens the new client form", async ({ page }) => {
  await mockShell(page);
  await mockClients(page, [makeClient({ id: "cl1", codCliente: "cli-01", name: "Acme SL" })]);
  await page.goto("/clientes");

  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  // The modal heading (h2) disambiguates from the "Nuevo cliente" button.
  await expect(page.getByRole("heading", { name: "Nuevo cliente" })).toBeVisible();
});

test("opens the edit form via the row pencil icon", async ({ page }) => {
  await mockShell(page);
  await mockClients(page, [makeClient({ id: "cl1", codCliente: "cli-01", name: "Acme SL" })]);
  await page.goto("/clientes");

  await page.locator("tbody tr", { hasText: "Acme SL" }).getByRole("button", { name: "Editar" }).click();
  await expect(page.locator(".card", { hasText: "Editar cliente" })).toBeVisible();
});

test("deletes a client after confirmation", async ({ page }) => {
  await mockShell(page);
  await mockClients(page, [
    makeClient({ id: "cl1", codCliente: "cli-01", name: "Borrame SL" }),
    makeClient({ id: "cl2", codCliente: "cli-02", name: "Quedate SL" }),
  ]);
  await page.goto("/clientes");

  await page.locator("tbody tr", { hasText: "Borrame SL" }).getByRole("button", { name: "Eliminar" }).click();
  const dialog = page.locator(".card", { hasText: "Eliminar cliente" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(page.getByText("Borrame SL")).toHaveCount(0);
  await expect(page.getByText("Quedate SL")).toBeVisible();
});
