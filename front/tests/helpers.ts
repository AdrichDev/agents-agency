import { type Page } from "@playwright/test";

export const TEST_USER = {
  id: "u1",
  firstName: "Test",
  lastName: "Admin",
  email: "admin@test.local",
  role: "admin",
};

/** Mocks the app-shell endpoints so pages render as an authenticated user. */
export async function mockShell(page: Page) {
  await page.route("**/api/auth/me", (r) => r.fulfill({ json: { user: TEST_USER } }));
  await page.route("**/api/auth/logout", (r) => r.fulfill({ json: { ok: true } }));
  // Sidebar pending-count badge (called on every page).
  await page.route("**/api/contacts/pending-count", (r) => r.fulfill({ json: { count: 0 } }));
}

export interface MockContact {
  id: string;
  codigo: string;
  type: "lead" | "prospecto";
  name: string;
  phone: string | null;
  email: string | null;
  sector: string | null;
  direccion: string | null;
  peticion: string | null;
  contactado: "si" | "no" | "nc";
  contactedAt: string | null;
  createdAt: string;
  clientId: string | null;
  client: null;
}

export function makeContact(over: Partial<MockContact> = {}): MockContact {
  return {
    id: "c" + Math.random().toString(36).slice(2, 9),
    codigo: "pc-00",
    type: "prospecto",
    name: "Contacto",
    phone: null,
    email: null,
    sector: null,
    direccion: null,
    peticion: null,
    contactado: "no",
    contactedAt: null,
    createdAt: "2026-01-01T10:00:00.000Z",
    clientId: null,
    client: null,
    ...over,
  };
}
