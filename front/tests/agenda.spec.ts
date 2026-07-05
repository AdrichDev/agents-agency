import { expect, test } from "@playwright/test";

test.describe("Agenda page", () => {
  test("renders the full-screen OperaOS agenda grammar", async ({ page }) => {
    await page.goto("/agenda");

    await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Semana" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Día" })).toBeVisible();

    await expect(page.getByTestId("agenda-calendar-grid")).toBeVisible();
    await expect(page.getByTestId("agenda-day-list")).toBeVisible();
    await expect(page.getByTestId("agenda-event-card").first()).toBeVisible();
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
    await expect(page.getByTestId("agenda-day-list")).toContainText("12/07/2026");
    await page.getByRole("button", { name: "Periodo anterior" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText(/29 jun.*5 jul 2026/i);

    await page.getByRole("button", { name: "Día" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText("Domingo 5 de Julio");
    await page.getByRole("button", { name: "Periodo siguiente" }).click();
    await expect(page.getByTestId("agenda-period-label")).toContainText("Lunes 6 de Julio");
    await expect(page.getByTestId("agenda-day-list")).toContainText("06/07/2026");
    await expect(page.getByTestId("agenda-day-list")).toContainText("Sin citas este día.");
    await expect(page.getByTestId("agenda-day-list")).not.toContainText("Clínica Norte");
  });

  test("opens detail modal when clicking an appointment card, showing contact info and Maps button", async ({ page }) => {
    await page.goto("/agenda");

    // Click on Clínica Norte card (has address)
    const cardClinica = page.getByTestId("agenda-event-card").filter({ hasText: "Clínica Norte" }).first();
    await cardClinica.click();

    // Check modal visibility and content
    const modal = page.getByTestId("agenda-detail-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("modal-commercial-name")).toContainText("Clínica Norte S.L.");
    await expect(modal.getByTestId("modal-contact-person")).toContainText("Dra. Elisa Martínez");
    await expect(modal.getByTestId("modal-phone")).toContainText("+34 600 111 222");
    await expect(modal.getByTestId("modal-address")).toContainText("Paseo de la Castellana 45, Madrid");
    await expect(modal.getByTestId("modal-notes")).toContainText("Revisar logs de WhatsApp y webhook de Telegram.");

    // Check location button is active and contains the correct link
    const locationBtn = modal.getByTestId("location-button");
    await expect(locationBtn).toBeVisible();
    await expect(locationBtn).toBeEnabled();
    await expect(locationBtn).toHaveAttribute("href", /google\.com\/maps/);

    // Close the modal
    await modal.getByTestId("modal-close-button").click();
    await expect(modal).not.toBeVisible();
  });

  test("disables location button in detail modal if appointment has no address", async ({ page }) => {
    await page.goto("/agenda");

    // Click on Innova Legal card (no address but has contactSummary)
    const cardInnova = page.getByTestId("agenda-event-card").filter({ hasText: "Innova Legal" }).first();
    await cardInnova.click();

    // Check modal and disabled location button
    const modal = page.getByTestId("agenda-detail-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("modal-address")).toContainText("Sin dirección física");

    const locationBtn = modal.getByTestId("location-button");
    await expect(locationBtn).toBeVisible();
    await expect(locationBtn).toBeDisabled();

    // Close modal
    await modal.getByTestId("modal-close-button").click();
    await expect(modal).not.toBeVisible();
  });
});
