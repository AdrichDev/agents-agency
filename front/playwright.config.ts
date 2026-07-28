import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- -p 3100",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
        // En produccion el polling del widget de Telegram nace apagado (kill-switch de
        // egress, `useTelegramInbox.ts:52`). Los e2e si cubren el refresco periodico del
        // badge, y `NEXT_PUBLIC_*` se inlinea en build: hay que encenderlo aqui.
        env: { NEXT_PUBLIC_TELEGRAM_POLLING: "on" },
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
