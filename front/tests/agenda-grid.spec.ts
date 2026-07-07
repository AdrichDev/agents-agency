import { expect, test } from "@playwright/test";

/**
 * Tests del motor AgendaGrid<T> (aa-agenda-operaos-parity P1/P2) sobre el
 * harness /agenda/grid-harness (grid aislado + datos demo, sin API ni sesión).
 * Patrón de la suite existente: page.clock.setFixedTime para "hoy" determinista.
 */

const HARNESS = "/agenda/grid-harness";

test.describe("AgendaGrid motor (P1)", () => {
  test("uses the real (mocked) system date as initial cursor and today highlight", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-09-15T10:00:00.000"));
    await page.goto(HARNESS);

    await expect(page.getByTestId("agenda-period-label")).toContainText("Septiembre 2026");
    const todayCell = page.locator('[data-today="true"]');
    await expect(todayCell).toHaveCount(1);
    await expect(todayCell).toHaveText("15");
  });

  test("keeps the selected day when switching month → week → day views", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-05T09:00:00.000"));
    await page.goto(HARNESS);

    // Seleccionar el día 15 en la vista mes (distinto de "hoy", que es el 5).
    await page.getByRole("button", { name: "Seleccionar 2026-07-15" }).click();
    await expect(page.getByTestId("agenda-day-list")).toContainText("15/07/2026");

    // Cambiar a semana: la semana visible contiene el 15 (no vuelve a hoy).
    await page.getByRole("button", { name: "Semana" }).click();
    await expect(page.getByRole("button", { name: "Semana" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("agenda-week-view")).toBeVisible();
    await expect(page.getByTestId("agenda-period-label")).toContainText(/13.*19 jul 2026/i);
    await expect(page.getByTestId("agenda-day-list")).toContainText("15/07/2026");

    // Cambiar a día: sigue sobre el 15 de julio, no sobre "hoy" (5).
    await page.getByRole("button", { name: "Día" }).click();
    await expect(page.getByTestId("agenda-day-view")).toBeVisible();
    await expect(page.getByTestId("agenda-period-label")).toContainText("15 de Julio");
  });

  test("navigating months from day 31 does not overflow to the wrong month", async ({ page }) => {
    // Cursor en 31 de enero: setMonth sin clamp rodaría a marzo (31 ene + 1 mes → 3 mar).
    await page.clock.setFixedTime(new Date("2026-01-31T10:00:00.000"));
    await page.goto(HARNESS);

    await expect(page.getByTestId("agenda-period-label")).toContainText("Enero 2026");
    await page.getByRole("button", { name: "Periodo siguiente" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText("Febrero 2026");
    await page.getByRole("button", { name: "Periodo siguiente" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText("Marzo 2026");
    await page.getByRole("button", { name: "Periodo anterior" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText("Febrero 2026");
  });

  test("navigating the week resyncs the selected day into the visible range", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-05T09:00:00.000"));
    await page.goto(HARNESS);

    await page.getByRole("button", { name: "Semana" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText(/29 jun.*5 jul 2026/i);
    // Al avanzar una semana, `selected` deja de anclarse al día original.
    await page.getByRole("button", { name: "Periodo siguiente" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText(/6.*12 jul 2026/i);
    await expect(page.getByTestId("agenda-day-list")).not.toContainText("05/07/2026");
  });
});

test.describe("Estados de cita: borde + badge (P2)", () => {
  test("Cancelada renders red left border and red badge; Confirmada renders accent + green", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-05T09:00:00.000"));
    await page.goto(HARNESS);

    // Hoy (05/07) hay una cita Confirmada (Clínica Norte): borde acento + badge green.
    const confirmada = page
      .getByTestId("agenda-day-list")
      .getByTestId("agenda-event-card")
      .filter({ hasText: "Clínica Norte" });
    await expect(confirmada).toBeVisible();
    await expect(confirmada).toHaveAttribute("data-tone", "green");
    // Borde = acento vigente (var(--accent-1)); el tema puede sobreescribir el
    // valor por defecto en runtime, así que se compara contra el token computado.
    const accent = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.color = "var(--accent-1)";
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    });
    await expect(confirmada).toHaveCSS("border-left-color", accent);
    await expect(confirmada.locator("span.rounded-full")).toHaveText("Confirmada");
    await expect(confirmada.locator("span.rounded-full")).toHaveClass(/text-emerald-400/);

    // El 15/07 hay una Cancelada (Mercurio Labs): borde rojo #ff4757 + badge red.
    await page.getByRole("button", { name: "Seleccionar 2026-07-15" }).click();
    const cancelada = page
      .getByTestId("agenda-day-list")
      .getByTestId("agenda-event-card")
      .filter({ hasText: "Mercurio Labs" });
    await expect(cancelada).toBeVisible();
    await expect(cancelada).toHaveAttribute("data-tone", "red");
    await expect(cancelada).toHaveCSS("border-left-color", "rgb(255, 71, 87)");
    await expect(cancelada.locator("span.rounded-full")).toHaveText("Cancelada");
    await expect(cancelada.locator("span.rounded-full")).toHaveClass(/text-red-400/);
  });

  test("compact card in week view hides the meta line", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-05T09:00:00.000"));
    await page.goto(HARNESS);

    await page.getByRole("button", { name: "Semana" }).click();
    const weekCard = page
      .getByTestId("agenda-week-view")
      .locator(".agenda-week-col-body")
      .getByTestId("agenda-event-card")
      .filter({ hasText: "Clínica Norte" });
    await expect(weekCard).toBeVisible();
    await expect(weekCard).toHaveClass(/cita-full-card-compact/);
    await expect(weekCard.locator(".meta")).toHaveCount(0);
  });
});
