import { test, expect } from "@playwright/test";

test.describe("Telegram page", () => {
  test("renders the direct chats view and allows selecting different conversations", async ({ page }) => {
    await page.goto("/telegram");

    // Check title/header and first conversation details are visible
    await expect(page.getByRole("heading", { name: "Telegram Chats" })).toBeVisible();
    await expect(page.getByTestId("chat-header-name")).toContainText("Clínica Norte S.L.");

    // Check that we can see message bubbles
    await expect(page.getByTestId("message-bubble-user").first()).toBeVisible();
    await expect(page.getByTestId("message-bubble-user").first()).toContainText(
      "Hola, me gustaría agendar una cita"
    );

    // Switch to the second conversation (Innova Legal)
    const secondChat = page.getByTestId("telegram-chat-item").filter({ hasText: "Innova Legal" });
    await expect(secondChat).toBeVisible();
    await secondChat.click();

    // Verify header and messages updated
    await expect(page.getByTestId("chat-header-name")).toContainText("Innova Legal");
    await expect(page.getByTestId("message-bubble-user").first()).toContainText(
      "onboarding de agente"
    );
  });

  test("allows sending messages manually and shows them in the chat window", async ({ page }) => {
    await page.goto("/telegram");

    // Select second conversation
    await page.getByTestId("telegram-chat-item").filter({ hasText: "Innova Legal" }).click();

    // Enter message content
    const input = page.getByTestId("chat-input");
    await expect(input).toBeVisible();
    await input.fill("Hola de parte del operador manual");

    // Click Send
    const sendButton = page.getByTestId("chat-send-button");
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    // The message should be added to the chat as an assistant message
    const lastBubble = page.getByTestId("message-bubble-assistant").last();
    await expect(lastBubble).toBeVisible();
    await expect(lastBubble).toContainText("Hola de parte del operador manual");
  });
});
