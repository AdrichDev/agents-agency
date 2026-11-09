/**
 * nanBuilders fail-closed in PLATFORM mode (the global client in `lib/openai.ts`).
 *
 * The BYOK path already refuses a `nan/*` model when nanBuilders is not configured
 * (`createGovernedClient`). The platform path did not: the routing choke point fell back to
 * the first configured provider, so the agent's prompt and the `nan/...` model id were sent to
 * OpenAI, which answered `400 invalid model ID`. A request for one provider must never be sent
 * to another one silently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls: Array<{ baseURL: string; model: string; endpoint: "chat" | "responses" }> = [];

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    baseURL: string;
    chat: { completions: { create: (body: { model: string }) => Promise<unknown> } };
    responses: { create: (body: { model: string }) => Promise<unknown> };
    constructor(opts: { baseURL?: string }) {
      this.baseURL = opts.baseURL ?? "https://api.openai.com/v1";
      this.chat = {
        completions: {
          create: async (body) => {
            calls.push({ baseURL: this.baseURL, model: body.model, endpoint: "chat" });
            return { choices: [{ message: { content: "ok" } }] };
          },
        },
      };
      // S5 (model-catalog): el SDK real expone `/v1/responses` y es la ruta de todo modelo del
      // proveedor OpenAI, así que el doble tiene que exponerla para representarlo.
      this.responses = {
        create: async (body) => {
          calls.push({ baseURL: this.baseURL, model: body.model, endpoint: "responses" });
          return { id: "resp_1", output: [] };
        },
      };
    }
  },
}));

vi.mock("@/lib/db", () => ({ prisma: { systemConfig: { findUnique: vi.fn() } } }));

const SAVED = { ...process.env };

async function loadClient() {
  vi.resetModules();
  return (await import("@/lib/openai")).openai;
}

beforeEach(() => {
  calls.length = 0;
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.NANBUILDERS_API_KEY;
  delete process.env.NANBUILDERS_BASE_URL;
});

afterEach(() => {
  process.env = { ...SAVED };
});

describe("platform client · nanBuilders not configured", () => {
  it("refuses a nan/* model instead of sending it to OpenAI", async () => {
    const client = await loadClient();
    const attempt = Promise.resolve().then(() =>
      client.chat.completions.create({ model: "nan/glm5.3-flash", messages: [] } as never)
    );

    await expect(attempt).rejects.toMatchObject({ status: 503, code: "LLM_PROVIDER_NOT_CONFIGURED" });
    await expect(attempt).rejects.toThrow(/nanBuilders/);
    expect(calls).toEqual([]);
  });

  it("keeps routing gpt models to OpenAI, now through /v1/responses", async () => {
    const client = await loadClient();
    await client.chat.completions.create({ model: "gpt-5.4-mini", messages: [] } as never);
    // Mismo destino (la API de OpenAI), endpoint distinto: S5 manda todo modelo `gpt*` por
    // `/v1/responses`. El llamador sigue viendo `chat.completions.create`.
    expect(calls).toEqual([
      { baseURL: "https://api.openai.com/v1", model: "gpt-5.4-mini", endpoint: "responses" },
    ]);
  });

  it("routes nan/* models to nanBuilders when it is configured (still chat.completions)", async () => {
    process.env.NANBUILDERS_API_KEY = "test-nb-key";
    process.env.NANBUILDERS_BASE_URL = "https://nb.test/v1";
    const client = await loadClient();
    await client.chat.completions.create({ model: "nan/glm5.3-flash", messages: [] } as never);
    expect(calls).toEqual([
      { baseURL: "https://nb.test/v1", model: "nan/glm5.3-flash", endpoint: "chat" },
    ]);
  });
});
