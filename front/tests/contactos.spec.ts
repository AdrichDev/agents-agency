import { expect, type Page, type Route, test } from "@playwright/test";
import { mockShell, makeContact, type MockContact } from "./helpers";

/**
 * Single handler for everything under /api/contacts**: pending-count,
 * convert-to-clients, DELETE, PATCH and the GET list. `state.contacts` is the
 * list the GET returns; tests mutate it before navigating.
 */
async function mockContacts(page: Page, contacts: MockContact[]) {
  const convertCalls: string[][] = [];
  await page.route("**/api/contacts**", async (route: Route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes("pending-count")) return route.fulfill({ json: { count: 0 } });
    if (url.includes("convert-to-clients")) {
      const body = route.request().postDataJSON() as { ids: string[] };
      convertCalls.push(body.ids);
      return route.fulfill({ json: { created: body.ids.map((id) => ({ contactId: id, clientId: "cl1" })), failed: [] } });
    }
    if (method === "DELETE") return route.fulfill({ json: { ok: true } });
    if (method === "PATCH") return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: contacts });
  });
  return { convertCalls };
}

test("renders the contacts table and sorts by Nombre", async ({ page }) => {
  await mockShell(page);
  await mockContacts(page, [
    makeContact({ id: "c1", codigo: "pc-01", name: "Zulema", createdAt: "2026-01-03T10:00:00Z" }),
    makeContact({ id: "c2", codigo: "pc-02", name: "Ana", createdAt: "2026-01-02T10:00:00Z" }),
    makeContact({ id: "c3", codigo: "pc-03", name: "Marco", createdAt: "2026-01-01T10:00:00Z" }),
  ]);
  await page.goto("/contactos");

  await expect(page.getByText("Zulema")).toBeVisible();
  // Default order is createdAt desc → Zulema first. Sort by Nombre asc → Ana first.
  await page.getByRole("button", { name: "Nombre" }).click();
  const firstRowName = page.locator("tbody tr").first();
  await expect(firstRowName).toContainText("Ana");
});

test("paginates to 10 items per page", async ({ page }) => {
  await mockShell(page);
  const many = Array.from({ length: 12 }, (_, i) =>
    makeContact({ id: `c${i}`, codigo: `pc-${i}`, name: `Contacto ${String(i).padStart(2, "0")}` })
  );
  await mockContacts(page, many);
  await page.goto("/contactos");

  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(2);
});

test("opens the info modal with all contact data", async ({ page }) => {
  await mockShell(page);
  await mockContacts(page, [
    makeContact({ id: "c1", codigo: "pc-01", name: "Ana", email: "ana@x.com", peticion: "Quiero un chatbot" }),
  ]);
  await page.goto("/contactos");

  await page.getByRole("button", { name: "Ver información" }).click();
  // Scope to the modal panel (email/name also appear in the table row).
  const dialog = page.locator(".card", { hasText: "Información del contacto" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Quiero un chatbot")).toBeVisible();
  await expect(dialog.getByText("ana@x.com")).toBeVisible();
});

test("deletes a contact after confirmation", async ({ page }) => {
  await mockShell(page);
  await mockContacts(page, [
    makeContact({ id: "c1", codigo: "pc-01", name: "Borrame" }),
    makeContact({ id: "c2", codigo: "pc-02", name: "Quedate" }),
  ]);
  await page.goto("/contactos");

  await expect(page.getByText("Borrame")).toBeVisible();
  await page.locator("tbody tr", { hasText: "Borrame" }).getByRole("button", { name: "Eliminar" }).click();
  // ConfirmProvider dialog — scope the confirm button to the dialog panel
  // (row icon buttons also expose aria-label "Eliminar").
  const dialog = page.locator(".card", { hasText: "Eliminar contacto" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(page.getByText("Borrame")).toHaveCount(0);
  await expect(page.getByText("Quedate")).toBeVisible();
});

test("converts a selected contact to a client", async ({ page }) => {
  await mockShell(page);
  const { convertCalls } = await mockContacts(page, [
    makeContact({ id: "c1", codigo: "pc-01", name: "Ana" }),
  ]);
  await page.goto("/contactos");

  await page.getByRole("button", { name: "Añadir a cliente" }).click();
  await page.locator("tbody tr", { hasText: "Ana" }).locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: /Aceptar/ }).click();
  // Confirm modal
  await expect(page.getByText("¿Estás de acuerdo con agregar a cliente")).toBeVisible();
  await page.getByRole("button", { name: "Aceptar", exact: true }).click();
  await expect.poll(() => convertCalls.length).toBeGreaterThan(0);
  expect(convertCalls[0]).toContain("c1");
});
