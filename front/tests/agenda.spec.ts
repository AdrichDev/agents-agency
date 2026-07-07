import { expect, test, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const DEMO_NOTICE_TEXT =
  "Los datos son demostrativos hasta conectar citas reales del tenant.";

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
    sub: "e2e-agenda-user",
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
      id: "e2e-agenda-user",
      aud: "authenticated",
      role: "authenticated",
      email: "e2e-agenda@test.local",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    },
  };
}

/** Cita con la misma forma que mapea la página (DemoAppointment + contactSummary). */
const MOCKED_API_APPOINTMENTS = [
  {
    id: "api-001",
    date: "2026-07-05",
    time: "10:15",
    client: "Tenant Real S.L.",
    service: "Cita servida por la API",
    owner: "Backend",
    status: "Confirmada",
    notes: "Cita real del tenant vía /api/booking/appointments.",
    contactSummary: {
      commercialName: "Tenant Real S.L.",
      contactPerson: "Marta Ruiz",
      phone: "+34 600 555 666",
      address: "Calle Mayor 1, Madrid",
    },
  },
];

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

/**
 * "Hoy" fijado de forma determinista para los tests (patrón OperaOS: la página
 * usa la fecha REAL del sistema, no una constante hardcodeada). Al congelar el
 * reloj del navegador en 2026-07-05 reproducimos la fecha sobre la que están
 * fechados los DEMO_APPOINTMENTS, de modo que las aserciones de datos demo con
 * fecha fija siguen siendo válidas mientras se ejercita el camino de fecha real.
 */
const FIXED_TODAY = new Date("2026-07-05T09:00:00.000");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_TODAY);
});

test.describe("Agenda page", () => {
  test("renders the full-screen OperaOS agenda grammar", async ({ page }) => {
    await page.goto("/agenda");

    await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
    await expect(page.getByTestId("agenda-add-task-btn")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Semana" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Día" })).toBeVisible();

    await expect(page.getByTestId("agenda-calendar-grid")).toBeVisible();
    await expect(page.getByTestId("agenda-day-list")).toBeVisible();
    await expect(page.getByTestId("agenda-event-card").first()).toBeVisible();

    // Cabecera de días (Lun-Dom) visible sobre el grid del mes (bug reportado:
    // calendario chico dejaba la cabecera colapsada/tapada).
    const header = page.locator(".calendar-grid-header");
    await expect(header).toBeVisible();
    await expect(header.locator("> div")).toHaveCount(7);
    const headerHeight = await header.evaluate((el) => el.getBoundingClientRect().height);
    expect(headerHeight).toBeGreaterThan(0);
  });

  test("switches between month, week and day views", async ({ page }) => {
    await page.goto("/agenda");

    await expect(page.getByTestId("agenda-month-view")).toBeVisible();

    await page.getByRole("button", { name: "Semana" }).click();
    await expect(page.getByRole("button", { name: "Semana" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("agenda-week-view")).toBeVisible();
    await expect(page.getByTestId("agenda-week-day")).toHaveCount(7);

    await page.getByRole("button", { name: "Día" }).click();
    await expect(page.getByRole("button", { name: "Día" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("agenda-day-view")).toBeVisible();
    await expect(page.getByText("09:00")).toBeVisible();

    await page.getByRole("button", { name: "Mes" }).click();
    await expect(page.getByRole("button", { name: "Mes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("agenda-month-view")).toBeVisible();
  });

  test("navigates the visible period for each agenda view", async ({ page }) => {
    await page.goto("/agenda");

    await expect(page.getByTestId("agenda-period-label")).toContainText("Julio 2026");
    await page.getByRole("button", { name: "Periodo siguiente" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText("Agosto 2026");
    await page.getByRole("button", { name: "Periodo anterior" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText("Julio 2026");

    await page.getByRole("button", { name: "Semana" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText(/29 jun.*5 jul 2026/i);
    await page.getByRole("button", { name: "Periodo siguiente" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText(/6.*12 jul 2026/i);
    // Re-sync de `selected` al navegar (AgendaGrid): al salir del rango, la
    // selección cae al primer día visible de la nueva semana (06/07).
    await expect(page.getByTestId("agenda-day-list")).toContainText("06/07/2026");
    await page.getByRole("button", { name: "Periodo anterior" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText(/29 jun.*5 jul 2026/i);

    // Vista día = hour-grid puro (paridad OperaOS): el DiaPanel (agenda-day-list)
    // solo existe en mes/semana, así que aquí se afirma sobre el propio grid.
    await page.getByRole("button", { name: "Día" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText("29 de Junio");
    await expect(page.getByTestId("agenda-day-view")).toBeVisible();
    await expect(page.getByTestId("agenda-day-list")).toHaveCount(0);
    await page.getByRole("button", { name: "Periodo siguiente" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText("30 de Junio");
    await expect(page.getByTestId("agenda-day-view")).not.toContainText("Clínica Norte");
  });

  test("opens the OperaOS detail modal (dl rows + Maps embed) when clicking a card (P5)", async ({ page }) => {
    // Sin red hacia Google: la visibilidad del iframe no depende de la red real.
    await page.route("https://www.google.com/**", (route) => route.abort());
    await page.goto("/agenda");

    // Clínica Norte: cita demo CON contactSummary.address.
    const cardClinica = page.getByTestId("agenda-event-card").filter({ hasText: "Clínica Norte" }).first();
    await cardClinica.click();

    const modal = page.getByTestId("agenda-detail-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByText("Detalle de cita")).toBeVisible();
    // Ficha dl/dt/dd: Cliente = nombre comercial del contactSummary + persona
    // de contacto + dirección.
    await expect(modal.getByText("Clínica Norte S.L.")).toBeVisible();
    await expect(modal.getByText("Dra. Elisa Martínez")).toBeVisible();
    await expect(modal.getByText("Paseo de la Castellana 45, Madrid")).toBeVisible();
    // Anotaciones precargadas en el textarea (guardado independiente).
    await expect(modal.getByTestId("agenda-detail-notes")).toHaveValue(/Revisar logs/);

    // Mapa embebido (embed público sin API key) + enlace "Abrir en Google Maps".
    await expect(modal.getByTestId("agenda-detail-map")).toBeVisible();
    await expect(modal.getByTestId("agenda-detail-map")).toHaveAttribute(
      "src",
      /google\.com\/maps\?q=.+output=embed/,
    );
    await expect(modal.getByTestId("agenda-detail-maps-link")).toHaveAttribute(
      "href",
      /google\.com\/maps\/search/,
    );

    // Botón × del chasis .opera-modal cierra.
    await modal.getByTestId("modal-close-button").click();
    await expect(modal).not.toBeVisible();
  });

  test("omits the address row and map embed when the appointment has no address (P5)", async ({ page }) => {
    await page.goto("/agenda");

    // Innova Legal: contactSummary sin dirección.
    const cardInnova = page.getByTestId("agenda-event-card").filter({ hasText: "Innova Legal" }).first();
    await cardInnova.click();

    const modal = page.getByTestId("agenda-detail-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByText("Innova Legal").first()).toBeVisible();
    // Sin dirección: la fila "Dirección" SÍ aparece (con "—"), pero no hay
    // iframe ni enlace; el bloque Ubicación muestra el aviso de sin dirección.
    await expect(modal.getByText("Dirección", { exact: true })).toBeVisible();
    await expect(modal.getByTestId("agenda-detail-map")).toHaveCount(0);
    await expect(modal.getByTestId("agenda-detail-maps-link")).toHaveCount(0);
    await expect(modal.getByTestId("agenda-detail-no-map")).toBeVisible();

    await modal.getByTestId("modal-close-button").click();
    await expect(modal).not.toBeVisible();
  });
});

test.describe("Agenda data source (demo fallback vs API)", () => {
  test("shows the demo-data notice when there is no auth session (demo fallback)", async ({ page }) => {
    // Sin sesión Supabase: getToken() devuelve null y la página conserva DEMO_APPOINTMENTS.
    await page.goto("/agenda");

    await expect(page.getByText(DEMO_NOTICE_TEXT)).toBeVisible();
    await expect(
      page.getByTestId("agenda-event-card").filter({ hasText: "Clínica Norte" }).first(),
    ).toBeVisible();
  });

  test("hides the demo notice and renders API appointments when the fetch succeeds", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(
      !supabaseUrl,
      "NEXT_PUBLIC_SUPABASE_URL is required to seed a Supabase session (front/.env.local)",
    );

    // Catch-all para el resto de llamadas al back disparadas por la sesión
    // (sidebar /api/config, /api/contacts/pending-count, /api/auth/me): 200 {}
    // para que ningún 401 real dispare el signOut+redirect del cliente api().
    await page.route("**/api/**", (route) => fulfillJson(route, {}));
    // Registrada después: en Playwright la última ruta registrada tiene prioridad.
    await page.route("**/api/booking/appointments", (route) =>
      fulfillJson(route, MOCKED_API_APPOINTMENTS),
    );

    // Sembrar la sesión falsa ANTES de que cargue la app para que getToken() vea token.
    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [supabaseStorageKey(supabaseUrl!), JSON.stringify(buildFakeSession())] as const,
    );

    await page.goto("/agenda");

    // La cita mockeada (fecha = día seleccionado inicial) sustituye al fallback demo.
    await expect(
      page.getByTestId("agenda-event-card").filter({ hasText: "Tenant Real S.L." }).first(),
    ).toBeVisible();
    await expect(page.getByTestId("agenda-day-list")).not.toContainText("Clínica Norte");

    // Con datos reales cargados, el aviso demo desaparece.
    await expect(page.getByText(DEMO_NOTICE_TEXT)).toHaveCount(0);
  });

  test("shows an explicit loading state (not demo data) while the API is in flight (T2)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(
      !supabaseUrl,
      "NEXT_PUBLIC_SUPABASE_URL is required to seed a Supabase session (front/.env.local)",
    );

    await page.route("**/api/**", (route) => fulfillJson(route, {}));
    // La lista de citas manuales devuelve [] (no bloquea el merge).
    await page.route("**/api/agenda/appointments", (route) => fulfillJson(route, []));
    // Retrasar la respuesta de reservas para observar el estado de carga explícito.
    await page.route("**/api/booking/appointments", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return fulfillJson(route, MOCKED_API_APPOINTMENTS);
    });

    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [supabaseStorageKey(supabaseUrl!), JSON.stringify(buildFakeSession())] as const,
    );

    await page.goto("/agenda");

    // Con sesión y fetch en vuelo: estado de carga visible, SIN datos demo fantasma.
    await expect(page.getByTestId("agenda-loading")).toBeVisible();
    await expect(page.getByText("Clínica Norte")).toHaveCount(0);
    await expect(page.getByText("Innova Legal")).toHaveCount(0);

    // Al resolver la API, aparece la cita real y el estado de carga desaparece.
    await expect(
      page.getByTestId("agenda-event-card").filter({ hasText: "Tenant Real S.L." }).first(),
    ).toBeVisible();
    await expect(page.getByTestId("agenda-loading")).toHaveCount(0);
  });
});

test.describe("Agenda selección persistente + navegación sin overflow (T4)", () => {
  test("navigating months from day 31 does not overflow to the wrong month (T4)", async ({ page }) => {
    // Cursor en 31 de enero: setMonth sin clamp rodaría a marzo (31 ene + 1 mes → 3 mar).
    await page.clock.setFixedTime(new Date("2026-01-31T10:00:00.000"));
    await page.goto("/agenda");

    await expect(page.getByTestId("agenda-period-label")).toContainText("Enero 2026");
    await page.getByRole("button", { name: "Periodo siguiente" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText("Febrero 2026");
    await page.getByRole("button", { name: "Periodo siguiente" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText("Marzo 2026");
    await page.getByRole("button", { name: "Periodo anterior" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText("Febrero 2026");
    await page.getByRole("button", { name: "Periodo anterior" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText("Enero 2026");
  });

  test("keeps the selected day when switching month → week → day views (T4)", async ({ page }) => {
    await page.goto("/agenda");

    // Seleccionar el día 15 en la vista mes (distinto de "hoy", que es el 5).
    await page.getByRole("button", { name: "Seleccionar 2026-07-15" }).click();
    await expect(page.getByTestId("agenda-day-list")).toContainText("15/07/2026");

    // Cambiar a vista semana: la semana visible contiene el 15 (no vuelve a hoy).
    await page.getByRole("button", { name: "Semana" }).click();
    await expect(page.getByTestId("agenda-week-view")).toBeVisible();
    await expect(page.getByTestId("agenda-period-label")).toContainText(/13.*19 jul 2026/i);
    await expect(page.getByTestId("agenda-day-list")).toContainText("15/07/2026");

    // Cambiar a vista día: sigue sobre el 15 de julio, no sobre "hoy" (5).
    // (En vista día no hay DiaPanel: el propio hour-grid ES el día seleccionado.)
    await page.getByRole("button", { name: "Día" }).click();
    await expect(page.getByTestId("agenda-day-view")).toBeVisible();
    await expect(page.getByTestId("agenda-period-label")).toContainText("15 de Julio");
    await expect(page.getByTestId("agenda-day-list")).toHaveCount(0);
  });
});

// NOTA P4/P5: el alta (T5/T9) ejercita el NuevaCitaModal estilo OperaOS (P4,
// components/agenda/nueva-cita-modal.tsx). El detalle/edición (T8) ejercita el
// CitaDetalleModal estilo OperaOS (P5, components/agenda/cita-detalle-modal.tsx).
test.describe("Agenda modal Añadir: validación + manejo de error (T5)", () => {
  /** Siembra sesión falsa + rutas base; devuelve el contador de POST al endpoint de citas. */
  async function setupCreateModal(
    page: import("@playwright/test").Page,
    supabaseUrl: string,
    onPost: (route: Route) => Promise<void> | void,
    existingAppointments: unknown[] = [],
  ) {
    const postCalls: string[] = [];
    await page.route("**/api/**", (route) => fulfillJson(route, {}));
    await page.route("**/api/booking/appointments", (route) => fulfillJson(route, []));
    // Cartera de clientes + equipo comercial mockeados: el modal los pide al
    // montar y sin esto el select de cliente/comercial quedaría vacío.
    await page.route("**/api/clients", (route) =>
      fulfillJson(route, [{ id: "t1", name: "Cliente Demo", email: "demo@test.com", phone: "600000000" }]),
    );
    // Cartera = clientes + contactos: el modal fusiona ambas listas en el select.
    await page.route("**/api/contacts", (route) =>
      fulfillJson(route, [
        { id: "c1", name: "Contacto Lead", email: "lead@test.com", phone: "611111111" },
      ]),
    );
    await page.route("**/api/agenda/team", (route) =>
      fulfillJson(route, [{ id: "u1", name: "Admin Uno", role: "admin" }]),
    );
    await page.route("**/api/agenda/appointments", async (route) => {
      if (route.request().method() === "POST") {
        postCalls.push(route.request().url());
        return onPost(route);
      }
      return fulfillJson(route, existingAppointments);
    });

    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [supabaseStorageKey(supabaseUrl), JSON.stringify(buildFakeSession())] as const,
    );

    await page.goto("/agenda");
    await page.getByTestId("agenda-add-task-btn").click();
    await expect(page.getByTestId("agenda-add-task-modal")).toBeVisible();
    return postCalls;
  }

  test("client is optional: empty client submits using the task as fallback title (T5-A)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    // El cliente ya NO es obligatorio: sin cartera ni nombre, el título cae a la
    // tarea (o "Cita personal"). Capturamos el body del POST para verificarlo.
    let postedClient: string | null = null;
    await setupCreateModal(page, supabaseUrl!, (route) => {
      postedClient = JSON.parse(route.request().postData() || "{}").client ?? null;
      return fulfillJson(route, {
        id: "srv-opt",
        date: "2026-07-05",
        time: "09:00",
        client: postedClient,
        service: "Auditoría",
        owner: "3A Estudio",
        status: "Confirmada",
      });
    });

    // Cliente vacío (solo la tarea rellena): antes bloqueaba, ahora procede.
    await page.getByTestId("agenda-add-task-service").selectOption("Otro");
    await page.getByTestId("agenda-add-task-service-custom").fill("Auditoría");
    await page.getByTestId("agenda-add-task-submit").click();

    // Éxito: modal cerrado y el título enviado cae a la tarea ("Auditoría").
    await expect(page.getByTestId("agenda-add-task-modal")).toHaveCount(0);
    expect(postedClient).toBe("Auditoría");
  });

  test("successful POST closes the modal and shows the new appointment (T5-B)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    const created = {
      id: "srv-001",
      date: "2026-07-05",
      time: "11:30",
      client: "Cliente Demo",
      service: "Onboarding",
      owner: "Sin asignar",
      // Mismo estado que el default del modal: no dispara el PATCH de ajuste.
      status: "Confirmada",
    };
    await setupCreateModal(page, supabaseUrl!, (route) => fulfillJson(route, created));

    await page.getByTestId("agenda-add-task-tenant").selectOption("client:t1");
    await page.getByTestId("agenda-add-task-service").selectOption("Onboarding");
    await page.getByTestId("agenda-add-task-submit").click();

    // Éxito: modal cerrado y la cita creada visible en la lista del día.
    await expect(page.getByTestId("agenda-add-task-modal")).toHaveCount(0);
    await expect(
      page.getByTestId("agenda-event-card").filter({ hasText: "Cliente Demo" }).first(),
    ).toBeVisible();
  });

  test("failed POST keeps the modal open with error, form data intact, no phantom appointment (T5-C)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await setupCreateModal(page, supabaseUrl!, (route) => {
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: CORS_HEADERS });
      }
      return route.fulfill({
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "boom" }),
      });
    });

    await page.getByTestId("agenda-add-task-tenant").selectOption("client:t1");
    await page.getByTestId("agenda-add-task-service").selectOption("Otro");
    await page.getByTestId("agenda-add-task-service-custom").fill("Consultoría");
    await page.getByTestId("agenda-add-task-submit").click();

    // Fallo: modal abierto con mensaje de error distinto al de validación.
    await expect(page.getByTestId("agenda-add-task-error")).toContainText(
      "No se pudo guardar la cita",
    );
    await expect(page.getByTestId("agenda-add-task-modal")).toBeVisible();
    // Los datos escritos se conservan (no se resetea el formulario).
    await expect(page.getByTestId("agenda-add-task-tenant")).toHaveValue("client:t1");
    await expect(page.getByTestId("agenda-add-task-service-custom")).toHaveValue("Consultoría");
    // Sin cita fantasma en la lista tras cerrar manualmente.
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByText("Cliente Demo")).toHaveCount(0);
  });

  // Test de estado no nativo en el alta eliminado ya que el modal no expone selector de estado

  // Cobertura de la reconstrucción del modal (aa-nueva-cita-rebuild): cartera de
  // clientes precargada, tareas predefinidas, comercial, chips de hora y la
  // sección Acción/Canal plegada en `notes`.
  test("client select preloads the tenant portfolio with the personal-appointment placeholder (a)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await setupCreateModal(page, supabaseUrl!, (route) => fulfillJson(route, {}));

    const tenantSelect = page.getByTestId("agenda-add-task-tenant");
    await expect(tenantSelect.locator("option").first()).toHaveText(
      "— Sin cartera de cliente (cita personal) —",
    );
    await expect(tenantSelect.locator("option", { hasText: "Cliente Demo" })).toHaveCount(1);
    // La cartera trae también los contactos (leads/prospectos), sin etiquetas y
    // en una sola lista alfabética (sin optgroups).
    await expect(tenantSelect.locator("option", { hasText: "Contacto Lead" })).toHaveCount(1);
    await expect(tenantSelect.locator("optgroup")).toHaveCount(0);
  });

  test("service select lists the predefined tasks and meetings catalog (b)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await setupCreateModal(page, supabaseUrl!, (route) => fulfillJson(route, {}));

    const serviceSelect = page.getByTestId("agenda-add-task-service");
    await expect(serviceSelect.locator("option", { hasText: /^Reunión$/ })).toHaveCount(1);
    await expect(serviceSelect.locator("option", { hasText: "Llamada de seguimiento" })).toHaveCount(1);
    await expect(serviceSelect.locator("option", { hasText: /^Onboarding$/ })).toHaveCount(1);
  });

  test("comercial select loads the mocked team from /api/agenda/team (c)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await setupCreateModal(page, supabaseUrl!, (route) => fulfillJson(route, {}));

    const comercialSelect = page.getByTestId("agenda-add-task-comercial");
    await expect(comercialSelect.locator("option").first()).toHaveText("Cualquiera");
    await expect(comercialSelect.locator("option", { hasText: "Admin Uno" })).toHaveCount(1);
  });

  test("hour chips only load after an employee is picked and disable the slot already taken that day (d)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await setupCreateModal(page, supabaseUrl!, (route) => fulfillJson(route, {}), [
      {
        id: "appt-taken",
        date: "2026-07-05",
        time: "09:30",
        client: "Cliente Ocupado S.L.",
        service: "Consultoría",
        owner: "3A Estudio",
        status: "Confirmada",
      },
    ]);

    await page.getByTestId("agenda-add-task-date").fill("2026-07-05");
    const chips = page.getByTestId("agenda-add-task-hour-chip");
    // Sin empleado seleccionado las horas no cargan: se muestra solo la pista.
    await expect(page.getByTestId("agenda-add-task-hour-hint")).toBeVisible();
    await expect(chips).toHaveCount(0);

    // Al elegir empleado, las horas disponibles aparecen.
    await page.getByTestId("agenda-add-task-comercial").selectOption("u1");
    await expect(page.getByTestId("agenda-add-task-hour-hint")).toHaveCount(0);
    await expect(chips.first()).toBeVisible();

    // La cita mockeada ocupa 2026-07-05 09:30: ese chip debe salir deshabilitado.
    const takenChip = chips.filter({ hasText: "09:30" });
    await expect(takenChip).toHaveAttribute("data-disabled", "true");
    await expect(takenChip).toBeDisabled();

    const freeChip = chips.filter({ hasText: "10:00" });
    await expect(freeChip).not.toHaveAttribute("data-disabled", "true");
  });

  test("Acción/Canal selects fold into the notes sent in the POST body (e)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    let capturedBody: any = null;
    const postCalls = await setupCreateModal(page, supabaseUrl!, async (route) => {
      capturedBody = route.request().postDataJSON();
      return fulfillJson(route, { id: "srv-003", ...capturedBody, owner: "3A Estudio", status: "Confirmada" });
    });

    await page.getByTestId("agenda-add-task-tenant").selectOption("client:t1");
    await page.getByTestId("agenda-add-task-accion").selectOption("Visita comercial");
    await page.getByTestId("agenda-add-task-canal").selectOption("Presencial");
    await page.getByTestId("agenda-add-task-notes").fill("Llevar catálogo");
    await page.getByTestId("agenda-add-task-comercial").selectOption("u1");
    await page.getByTestId("agenda-add-task-submit").click();

    await expect(page.getByTestId("agenda-add-task-modal")).toHaveCount(0);
    expect(postCalls).toHaveLength(1);
    expect(capturedBody.notes).toContain("Comercial: Admin Uno");
    expect(capturedBody.notes).toContain("Acción: Visita comercial | Canal: Presencial | Comentarios: Llevar catálogo");
  });
});

test.describe("Agenda real today + compact day panel (T1/T3)", () => {
  test("uses the real system date as the initial cursor and today highlight (T1)", async ({ page }) => {
    // Reloj distinto al de los datos demo: prueba que el cursor sigue la fecha
    // real del sistema y no una constante fija (2026-07-05).
    await page.clock.setFixedTime(new Date("2026-09-15T10:00:00.000"));
    await page.goto("/agenda");

    await expect(page.getByTestId("agenda-period-label")).toContainText("Septiembre 2026");

    const todayCell = page.locator('[data-today="true"]');
    await expect(todayCell).toHaveCount(1);
    await expect(todayCell).toHaveText("15");
  });

  test("renders full OperaOS cards (with meta and actions) inside the day panel (T3)", async ({ page }) => {
    // Reloj en 2026-07-05: el panel del día muestra las citas demo de ese día.
    await page.goto("/agenda");

    const dayCard = page
      .getByTestId("agenda-day-list")
      .getByTestId("agenda-event-card")
      .first();
    await expect(dayCard).toBeVisible();
    // Markup OperaOS: chasis .cita-full-card completo (no compact) con meta
    // `servicio · owner` y RowActions Editar/Eliminar.
    await expect(dayCard).toHaveClass(/cita-full-card/);
    await expect(dayCard).not.toHaveClass(/cita-full-card-compact/);
    await expect(dayCard.locator(".meta")).toBeVisible();
    await expect(dayCard.getByTestId("agenda-card-edit")).toBeVisible();
    await expect(dayCard.getByTestId("agenda-card-delete")).toBeVisible();
  });

  test("week view renders compact cards without meta (P3)", async ({ page }) => {
    await page.goto("/agenda");

    await page.getByRole("button", { name: "Semana" }).click();
    const weekCard = page
      .getByTestId("agenda-week-view")
      .locator(".agenda-week-col-body")
      .getByTestId("agenda-event-card")
      .first();
    await expect(weekCard).toBeVisible();
    await expect(weekCard).toHaveClass(/cita-full-card-compact/);
    await expect(weekCard.locator(".meta")).toHaveCount(0);
  });
});

test.describe("Agenda contacto por cita (T9)", () => {
  /** Siembra sesión + rutas y devuelve los bodies de los POST a /api/agenda/appointments. */
  async function setupContactPage(
    page: import("@playwright/test").Page,
    supabaseUrl: string,
    appointments: unknown[],
  ) {
    const postBodies: any[] = [];
    // Sin red hacia Google: el iframe del mapa no depende de la red real.
    await page.route("https://www.google.com/**", (route) => route.abort());
    await page.route("**/api/**", (route) => fulfillJson(route, {}));
    await page.route("**/api/booking/appointments", (route) => fulfillJson(route, []));
    await page.route("**/api/clients", (route) =>
      fulfillJson(route, [{ id: "t1", name: "Cliente Demo", email: "demo@test.com", phone: "600000000" }]),
    );
    // Cartera = clientes + contactos: el modal fusiona ambas listas en el select.
    await page.route("**/api/contacts", (route) =>
      fulfillJson(route, [
        { id: "c1", name: "Contacto Lead", email: "lead@test.com", phone: "611111111" },
      ]),
    );
    await page.route("**/api/agenda/team", (route) =>
      fulfillJson(route, [{ id: "u1", name: "Admin Uno", role: "admin" }]),
    );
    await page.route("**/api/agenda/appointments", async (route) => {
      if (route.request().method() === "POST") {
        postBodies.push(route.request().postDataJSON());
        // Estado = default del modal ("Confirmada"): sin PATCH de ajuste posterior.
        return fulfillJson(route, { id: "srv-t9", ...route.request().postDataJSON(), owner: "3A Estudio", status: "Confirmada" });
      }
      return fulfillJson(route, appointments);
    });

    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [supabaseStorageKey(supabaseUrl), JSON.stringify(buildFakeSession())] as const,
    );

    await page.goto("/agenda");
    return postBodies;
  }

  test("creating an appointment sends optional email/phone in the POST body (T9-A)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    const postBodies = await setupContactPage(page, supabaseUrl!, []);

    await page.getByTestId("agenda-add-task-btn").click();
    await expect(page.getByTestId("agenda-add-task-modal")).toBeVisible();

    await page.getByTestId("agenda-add-task-tenant").selectOption("client:t1");
    await page.getByTestId("agenda-add-task-service").selectOption("Otro");
    await page.getByTestId("agenda-add-task-service-custom").fill("Consultoría");
    await page.getByTestId("agenda-add-task-submit").click();

    await expect(page.getByTestId("agenda-add-task-modal")).toHaveCount(0);
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]).toMatchObject({
      client: "Cliente Demo",
      email: "demo@test.com",
      phone: "600000000",
    });
    // El POST del back no acepta `status`: el modal no lo envía en el alta.
    expect(postBodies[0]).not.toHaveProperty("status");
  });

  test("detail modal renders the contactSummary served by the API (T9-B)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await setupContactPage(page, supabaseUrl!, [
      {
        id: "appt-t9",
        date: "2026-07-05",
        time: "10:00",
        client: "Clínica Contacto",
        service: "Consultoría",
        owner: "3A Estudio",
        status: "Confirmada",
        email: "norte@clinica.es",
        phone: "+34 600 111 222",
        contactSummary: {
          commercialName: "Clínica Norte S.L.",
          contactPerson: "Dra. Elisa Martínez",
          phone: "+34 600 111 222",
          address: "Paseo de la Castellana 45, Madrid",
        },
      },
    ]);

    await page
      .getByTestId("agenda-event-card")
      .filter({ hasText: "Clínica Contacto" })
      .first()
      .locator(".time")
      .click();

    const modal = page.getByTestId("agenda-detail-modal");
    await expect(modal).toBeVisible();
    // Filas dl/dt/dd con el contactSummary resuelto por el back.
    await expect(modal.getByText("Clínica Norte S.L.")).toBeVisible();
    await expect(modal.getByText("Dra. Elisa Martínez")).toBeVisible();
    await expect(modal.getByText("Paseo de la Castellana 45, Madrid")).toBeVisible();
    // Mapa embebido + enlace a Google Maps (hay dirección).
    await expect(modal.getByTestId("agenda-detail-map")).toHaveAttribute("src", /google\.com\/maps/);
    await expect(modal.getByTestId("agenda-detail-maps-link")).toHaveAttribute("href", /google\.com\/maps/);
  });

  test("detail modal without contactSummary/email/phone does not break (T9-C)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await setupContactPage(page, supabaseUrl!, [
      {
        id: "appt-t9-bare",
        date: "2026-07-05",
        time: "10:00",
        client: "Cliente Sin Contacto",
        service: "Consultoría",
        owner: "3A Estudio",
        status: "Pendiente",
      },
    ]);

    await page
      .getByTestId("agenda-event-card")
      .filter({ hasText: "Cliente Sin Contacto" })
      .first()
      .locator(".time")
      .click();

    const modal = page.getByTestId("agenda-detail-modal");
    await expect(modal).toBeVisible();
    // Todas las filas se muestran siempre (paridad OperaOS): sin datos, con
    // fallback "—". El nombre libre de la cita alimenta Cliente y Persona de
    // contacto, así que aparece en dos filas. Email/Teléfono ya no son filas.
    await expect(modal.getByText("Cliente Sin Contacto").first()).toBeVisible();
    await expect(modal.getByText("Persona de contacto")).toBeVisible();
    await expect(modal.getByText("Email")).toHaveCount(0);
    await expect(modal.getByText("Teléfono")).toHaveCount(0);
    await expect(modal.getByText("Dirección", { exact: true })).toBeVisible();
    await expect(modal.getByTestId("agenda-detail-map")).toHaveCount(0);
    await expect(modal.getByTestId("agenda-detail-maps-link")).toHaveCount(0);
    await expect(modal.getByTestId("agenda-detail-no-map")).toBeVisible();
  });

  test("detail modal shows the Profesional row parsed from the 'Comercial:' notes segment (P-profesional)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await setupContactPage(page, supabaseUrl!, [
      {
        id: "appt-t9-profesional",
        date: "2026-07-05",
        time: "10:00",
        client: "Cliente Con Comercial",
        service: "Consultoría",
        owner: "3A Estudio",
        status: "Confirmada",
        // Comercial plegado en notes por nueva-cita-modal.tsx (sin columna dedicada).
        notes: "Comercial: Ana Ruiz | Acción: Visita comercial | Canal: Presencial",
      },
    ]);

    await page
      .getByTestId("agenda-event-card")
      .filter({ hasText: "Cliente Con Comercial" })
      .first()
      .locator(".time")
      .click();

    const modal = page.getByTestId("agenda-detail-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByText("Profesional")).toBeVisible();
    await expect(modal.getByText("Ana Ruiz")).toBeVisible();

    // La caja de Anotaciones NUNCA muestra el segmento "Comercial: ..." plegado
    // (splitComercial en acciones-canales.ts), aunque la fila Profesional lo siga
    // resolviendo desde `appointment.notes` completo.
    const notesTextarea = modal.getByTestId("agenda-detail-notes");
    await expect(notesTextarea).toHaveValue(/^(?!.*Comercial:).*$/s);
    await expect(notesTextarea).toHaveValue(/Acción: Visita comercial \| Canal: Presencial/);

    // Guardar la anotación editada preserva el Comercial en storage: se edita
    // el textarea (limpio) y el PATCH resultante debe seguir alimentando
    // la fila Profesional tras recargar el detalle.
    await notesTextarea.fill("Acción: Visita comercial | Canal: Presencial | Comentarios: Editado");
    await modal.getByTestId("agenda-detail-save-note-btn").click();
    await expect(modal.getByText("Ana Ruiz")).toBeVisible();
  });

  test("detail modal shows '—' in the Profesional row when notes has no 'Comercial:' segment (P-profesional)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await setupContactPage(page, supabaseUrl!, [
      {
        id: "appt-t9-sin-comercial",
        date: "2026-07-05",
        time: "10:00",
        client: "Cliente Sin Comercial",
        service: "Consultoría",
        owner: "3A Estudio",
        status: "Confirmada",
        notes: "Acción: Prospección | Canal: Llamada",
      },
    ]);

    await page
      .getByTestId("agenda-event-card")
      .filter({ hasText: "Cliente Sin Comercial" })
      .first()
      .locator(".time")
      .click();

    const modal = page.getByTestId("agenda-detail-modal");
    await expect(modal).toBeVisible();
    const filaProfesional = modal.locator("div", { has: page.getByText("Profesional", { exact: true }) }).first();
    await expect(filaProfesional).toContainText("—");
  });
});

test.describe("Agenda acciones por cita: estado, editar, eliminar (T8)", () => {
  /** Cita AA nativa servida por /api/agenda/appointments (editable vía PATCH/DELETE). */
  const BASE_APPT = {
    id: "appt-100",
    date: "2026-07-05",
    time: "09:00",
    client: "Cliente Editable S.L.",
    service: "Consultoría",
    owner: "Backend",
    status: "Pendiente",
    notes: "Nota original",
  };

  /**
   * Siembra sesión falsa + rutas base y abre el modal de detalle sobre la cita
   * nativa. onMutate atiende PATCH/DELETE a /api/agenda/appointments/:id.
   */
  async function setupDetailModal(
    page: import("@playwright/test").Page,
    supabaseUrl: string,
    onMutate: (route: Route) => Promise<void> | void,
  ) {
    await page.route("**/api/**", (route) => fulfillJson(route, {}));
    await page.route("**/api/booking/appointments", (route) => fulfillJson(route, []));
    await page.route("**/api/agenda/appointments", (route) => fulfillJson(route, [BASE_APPT]));
    // Ruta con :id (no matchea la de arriba): PATCH/DELETE + preflight CORS.
    await page.route("**/api/agenda/appointments/*", (route) => {
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: CORS_HEADERS });
      }
      return onMutate(route);
    });

    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [supabaseStorageKey(supabaseUrl), JSON.stringify(buildFakeSession())] as const,
    );

    await page.goto("/agenda");
    await page
      .getByTestId("agenda-event-card")
      .filter({ hasText: BASE_APPT.client })
      .first()
      .locator(".time")
      .click();
    await expect(page.getByTestId("agenda-detail-modal")).toBeVisible();
  }

  test("quick status change persists via PATCH and updates modal + card (T8-A)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await setupDetailModal(page, supabaseUrl!, (route) =>
      fulfillJson(route, { ...BASE_APPT, status: "Completada" }),
    );

    await page.getByTestId("agenda-detail-status-select").selectOption("Completada");

    // El select refleja el estado devuelto por el back (no el optimista).
    await expect(page.getByTestId("agenda-detail-status-select")).toHaveValue("Completada");
    // La tarjeta de la lista del día también se actualiza.
    await page.getByTestId("modal-close-button").click();
    await expect(
      page.getByTestId("agenda-day-list").getByTestId("agenda-event-card").first(),
    ).toContainText("Completada");
  });

  test("editing a field saves via PATCH and refreshes the detail view (T8-B)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await setupDetailModal(page, supabaseUrl!, async (route) => {
      const patch = route.request().postDataJSON();
      return fulfillJson(route, { ...BASE_APPT, ...patch });
    });

    await page.getByTestId("agenda-detail-edit-btn").click();
    await expect(page.getByTestId("agenda-edit-form")).toBeVisible();

    await page.getByPlaceholder("Anotaciones opcionales").fill("Nota editada por e2e");
    await page.getByTestId("agenda-detail-save-btn").click();

    // Éxito: vuelve al modo lectura con la nota actualizada en el textarea.
    await expect(page.getByTestId("agenda-edit-form")).toHaveCount(0);
    await expect(page.getByTestId("agenda-detail-notes")).toHaveValue("Nota editada por e2e");
  });

  test("saving an annotation PATCHes only the notes without opening the edit form (P5)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    const patchBodies: any[] = [];
    await setupDetailModal(page, supabaseUrl!, (route) => {
      patchBodies.push(route.request().postDataJSON());
      return fulfillJson(route, { ...BASE_APPT, notes: "Anotación rápida" });
    });

    await page.getByTestId("agenda-detail-notes").fill("Anotación rápida");
    await page.getByTestId("agenda-detail-save-note-btn").click();

    // PATCH con SOLO las notas, sin pasar por el formulario completo.
    await expect.poll(() => patchBodies.length).toBe(1);
    expect(patchBodies[0]).toEqual({ notes: "Anotación rápida" });
    await expect(page.getByTestId("agenda-edit-form")).toHaveCount(0);
    await expect(page.getByTestId("agenda-detail-notes")).toHaveValue("Anotación rápida");
  });

  test("failed PATCH shows an error and keeps the form data + original appointment (T8-C)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await setupDetailModal(page, supabaseUrl!, (route) =>
      route.fulfill({
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "boom" }),
      }),
    );

    await page.getByTestId("agenda-detail-edit-btn").click();
    await page.getByPlaceholder("Anotaciones opcionales").fill("Cambio que fallará");
    await page.getByTestId("agenda-detail-save-btn").click();

    // Fallo: error visible, el formulario sigue abierto y conserva lo escrito.
    await expect(page.getByTestId("agenda-detail-error")).toContainText(
      "No se pudieron guardar los cambios",
    );
    await expect(page.getByTestId("agenda-edit-form")).toBeVisible();
    await expect(page.getByPlaceholder("Anotaciones opcionales")).toHaveValue(
      "Cambio que fallará",
    );

    // La cita original sigue intacta en la lista tras cerrar el modal.
    await page.getByTestId("modal-close-button").click();
    const card = page.getByTestId("agenda-day-list").getByTestId("agenda-event-card").first();
    await expect(card).toContainText(BASE_APPT.client);
    await expect(card).toContainText("Pendiente");
  });

  test("confirmed delete removes the appointment and closes the modal (T8-D)", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await setupDetailModal(page, supabaseUrl!, (route) =>
      route.fulfill({ status: 204, headers: CORS_HEADERS }),
    );

    // El borrado ya no vive en el detalle: se dispara desde RowActions de la
    // tarjeta. Se cierra el detalle y se usa el botón "Eliminar" de la tarjeta.
    await page.getByTestId("modal-close-button").click();
    await expect(page.getByTestId("agenda-detail-modal")).toHaveCount(0);

    await page
      .getByTestId("agenda-day-list")
      .getByTestId("agenda-event-card")
      .filter({ hasText: BASE_APPT.client })
      .first()
      .getByTestId("agenda-card-delete")
      .click();
    // Confirmación en modal propio (sustituye a window.confirm nativo).
    await expect(page.getByTestId("agenda-delete-confirm")).toBeVisible();
    await page.getByTestId("agenda-delete-confirm-btn").click();

    // Éxito: la cita sale de la lista del día.
    await expect(page.getByTestId("agenda-delete-confirm")).toHaveCount(0);
    await expect(page.getByTestId("agenda-day-list")).not.toContainText(BASE_APPT.client);
    await expect(page.getByTestId("agenda-day-list")).toContainText("Sin citas este día.");
  });
});

test.describe("Agenda detalle de cita: apertura por click en la tarjeta", () => {
  test("clicking the client name opens the ficha, clicking the rest opens the detail", async ({ page }) => {
    await page.goto("/agenda");

    // Clínica Norte: cita demo con contactSummary completo (aa-001).
    const card = page.getByTestId("agenda-event-card").filter({ hasText: "Clínica Norte" }).first();

    // Click en el nombre del cliente: abre la ficha de cliente (estilo OperaOS).
    await card.getByTestId("agenda-card-client-btn").click();
    await expect(page.getByTestId("agenda-cliente-modal")).toBeVisible();
    await expect(page.getByTestId("agenda-detail-modal")).toHaveCount(0);
    await page.getByTestId("modal-close-button").click();
    await expect(page.getByTestId("agenda-cliente-modal")).toHaveCount(0);

    // Click en el resto de la tarjeta (la hora, fuera del botón de cliente):
    // abre el detalle, no la ficha.
    await card.locator(".time").click();
    await expect(page.getByTestId("agenda-detail-modal")).toBeVisible();
    await expect(page.getByTestId("agenda-cliente-modal")).toHaveCount(0);
  });
});

test.describe("Agenda evento importado de Google en el detalle (P5)", () => {
  test("google event shows the imported note and offers no edit/delete/status actions", async ({ page }) => {
    const supabaseUrl = resolveSupabaseUrl();
    test.skip(!supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required (front/.env.local)");

    await page.route("**/api/**", (route) => fulfillJson(route, {}));
    await page.route("**/api/booking/appointments", (route) => fulfillJson(route, []));
    await page.route("**/api/agenda/appointments", (route) => fulfillJson(route, []));
    // Calendar de plataforma conectado + un evento importado en el día visible.
    await page.route("**/api/calendar/status", (route) =>
      fulfillJson(route, { connected: true, accountLabel: "owner@gmail.com" }),
    );
    await page.route("**/api/calendar/events*", (route) =>
      fulfillJson(route, {
        events: [
          {
            id: "gev-1",
            title: "Evento importado",
            start: "2026-07-05T09:00:00.000Z",
            end: "2026-07-05T10:00:00.000Z",
            allDay: false,
          },
        ],
      }),
    );

    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [supabaseStorageKey(supabaseUrl!), JSON.stringify(buildFakeSession())] as const,
    );

    await page.goto("/agenda");
    await page
      .getByTestId("agenda-google-event-card")
      .filter({ hasText: "Evento importado" })
      .first()
      .click();

    const modal = page.getByTestId("agenda-detail-modal");
    await expect(modal).toBeVisible();
    // Nota informativa: los eventos de Google no tienen fila en BD.
    await expect(modal.getByTestId("agenda-detail-google-note")).toContainText(
      "edítalo desde Google",
    );
    // Sin acciones editables: ni Editar, ni Eliminar, ni select de estado,
    // ni guardado de anotaciones.
    await expect(modal.getByTestId("agenda-detail-edit-btn")).toHaveCount(0);
    await expect(modal.getByTestId("agenda-detail-delete-btn")).toHaveCount(0);
    await expect(modal.getByTestId("agenda-detail-status-select")).toHaveCount(0);
    await expect(modal.getByTestId("agenda-detail-save-note-btn")).toHaveCount(0);
  });
});
