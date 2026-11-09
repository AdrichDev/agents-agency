// S5 (odd/tasks/model-catalog.md) — el punto único de cliente: TODO modelo del proveedor OpenAI
// sale por `/v1/responses`, y las 13 llamadas que hoy usan `chat.completions` no cambian una línea.
//
// Aquí se mockea el SDK `openai` (sin red, constructor stub) para poder mirar qué endpoint y qué
// cuerpo acaban llegando al proveedor, que es lo único que distingue "traducido" de "traducido
// bien". Dos entradas al mismo adaptador:
//   - el cliente global de `lib/openai.ts` (plataforma, clave de `process.env`);
//   - `createGovernedClient` (BYOK, clave del tenant).
// El resto de proveedores (Gemini, Anthropic, nanBuilders) tiene que seguir exactamente por
// `chat.completions` con el MISMO cuerpo: son los tests de regresión de este fichero.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Recorded = { endpoint: "chat" | "responses"; baseURL: string; body: any };
const calls: Recorded[] = [];

const CHAT_REPLY = { choices: [{ message: { content: "respuesta de chat" } }], usage: { total_tokens: 3 } };
const RESPONSES_REPLY = {
  id: "resp_1",
  object: "response",
  model: "gpt-5.4-mini",
  status: "completed",
  output: [
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hola humano" }] },
  ],
  usage: {
    input_tokens: 8,
    output_tokens: 2,
    total_tokens: 10,
    input_tokens_details: { cached_tokens: 4 },
  },
};

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    baseURL: string;
    chat: { completions: { create: (body: any) => Promise<unknown> } };
    responses: { create: (body: any) => Promise<unknown> };
    constructor(opts: { baseURL?: string }) {
      this.baseURL = opts.baseURL ?? "https://api.openai.com/v1";
      this.chat = {
        completions: {
          create: async (body: any) => {
            calls.push({ endpoint: "chat", baseURL: this.baseURL, body });
            return CHAT_REPLY;
          },
        },
      };
      this.responses = {
        create: async (body: any) => {
          calls.push({ endpoint: "responses", baseURL: this.baseURL, body });
          return { ...RESPONSES_REPLY, model: body?.model ?? RESPONSES_REPLY.model };
        },
      };
    }
  },
}));

vi.mock("@/lib/db", () => ({ prisma: { systemConfig: { findUnique: vi.fn() } } }));
// Evita que `dotenv.config()` de lib/openai.ts lea el .env real: este fichero es hermético.
vi.mock("dotenv", () => ({ default: { config: vi.fn() }, config: vi.fn() }));

const SAVED = { ...process.env };

async function loadClient() {
  vi.resetModules();
  return (await import("@/lib/openai")).openai;
}

beforeEach(() => {
  calls.length = 0;
  process.env = { ...SAVED };
  process.env.OPENAI_API_KEY = "sk-plataforma";
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.NANBUILDERS_API_KEY;
  delete process.env.NANBUILDERS_BASE_URL;
  delete process.env.OPENAI_REASONING_EFFORT;
});

afterEach(() => {
  process.env = { ...SAVED };
});

const landingBody = {
  model: "gpt-5.4-mini",
  max_completion_tokens: 700,
  temperature: 0.3,
  messages: [
    { role: "system", content: "Eres experto en agentes" },
    { role: "user", content: "Mejora este prompt" },
  ],
};

describe("cliente global · todo modelo OpenAI sale por /v1/responses (S5)", () => {
  it("traduce la petición y devuelve al llamador un ChatCompletion con contenido y usage", async () => {
    const client = await loadClient();

    const out = (await client.chat.completions.create(landingBody as never)) as any;

    expect(calls).toHaveLength(1);
    expect(calls[0].endpoint).toBe("responses");
    expect(calls[0].baseURL).toBe("https://api.openai.com/v1");
    expect(calls[0].body).toMatchObject({
      model: "gpt-5.4-mini",
      store: false,
      max_output_tokens: 700,
      // El effort por defecto se resuelve contra el catálogo, igual que en la ruta chat.
      reasoning: { effort: "low" },
      input: [
        { role: "system", content: "Eres experto en agentes" },
        { role: "user", content: "Mejora este prompt" },
      ],
    });
    expect(calls[0].body).not.toHaveProperty("messages");
    expect(calls[0].body).not.toHaveProperty("temperature");

    // El contrato de vuelta no cambia: el llamador lee choices/usage como siempre.
    expect(out.choices[0].message.content).toBe("Hola humano");
    expect(out.usage).toEqual({
      prompt_tokens: 8,
      completion_tokens: 2,
      total_tokens: 10,
      prompt_tokens_details: { cached_tokens: 4 },
    });
  });

  it("traduce response_format json_object del scraper a text.format", async () => {
    const client = await loadClient();

    await client.chat.completions.create({
      model: "gpt-5.4-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: "Devuelve JSON" }],
    } as never);

    expect(calls[0].endpoint).toBe("responses");
    expect(calls[0].body.text).toEqual({ format: { type: "json_object" } });
    expect(calls[0].body).not.toHaveProperty("response_format");
  });

  it("un modelo de un proveedor OpenAI-compatible NO cambia: gemini sigue por chat, mismo body", async () => {
    process.env.GEMINI_API_KEY = "gm-clave";
    const client = await loadClient();

    await client.chat.completions.create({
      model: "gemini-3.5-flash",
      max_completion_tokens: 800,
      temperature: 0.2,
      messages: [{ role: "user", content: "hola" }],
    } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0].endpoint).toBe("chat");
    expect(calls[0].baseURL).toContain("generativelanguage.googleapis.com");
    // Cuerpo de siempre: la gobernanza inyecta el effort del catálogo y borra `temperature`
    // porque Gemini 3.x es razonador.
    expect(calls[0].body).toEqual({
      model: "gemini-3.5-flash",
      max_completion_tokens: 800,
      messages: [{ role: "user", content: "hola" }],
      reasoning_effort: "low",
    });
  });

  it("nanBuilders sigue por chat con su propio body y su propia base", async () => {
    process.env.NANBUILDERS_API_KEY = "nb-clave";
    process.env.NANBUILDERS_BASE_URL = "https://nb.test/v1";
    const client = await loadClient();

    await client.chat.completions.create({
      model: "nan/glm5.3-flash",
      max_completion_tokens: 900,
      temperature: 0.5,
      messages: [{ role: "user", content: "hola" }],
    } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0].endpoint).toBe("chat");
    expect(calls[0].baseURL).toBe("https://nb.test/v1");
    // El modelo no está en la tabla de capacidades: sin effort y CON su temperature.
    expect(calls[0].body).toEqual({
      model: "nan/glm5.3-flash",
      max_completion_tokens: 900,
      temperature: 0.5,
      messages: [{ role: "user", content: "hola" }],
    });
  });

  it("Anthropic sigue por chat y conserva su temperature", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    const client = await loadClient();

    await client.chat.completions.create({
      model: "claude-opus-5",
      temperature: 0.3,
      messages: [{ role: "user", content: "hola" }],
    } as never);

    expect(calls[0].endpoint).toBe("chat");
    expect(calls[0].baseURL).toBe("https://api.anthropic.com/v1/");
    expect(calls[0].body).toEqual({
      model: "claude-opus-5",
      temperature: 0.3,
      messages: [{ role: "user", content: "hola" }],
    });
  });

  it("sin OPENAI_API_KEY se mantiene el fallback histórico a chat (no hay Responses API a la que ir)", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = "gm-clave";
    const client = await loadClient();

    await client.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [{ role: "user", content: "hola" }],
    } as never);

    expect(calls[0].endpoint).toBe("chat");
    expect(calls[0].baseURL).toContain("generativelanguage.googleapis.com");
  });
});

describe("cliente BYOK · el mismo adaptador para la clave del tenant (S5)", () => {
  it("un cliente BYOK de OpenAI traduce a /v1/responses", async () => {
    const { createGovernedClient } = await import("@/lib/llm/governance");
    const client = createGovernedClient({
      provider: "openai",
      apiKey: "sk-tenant",
      defaultEffort: () => "high",
    });

    const out = (await client.chat.completions.create({
      model: "gpt-5.4-mini",
      max_completion_tokens: 400,
      temperature: 0.2,
      messages: [{ role: "user", content: "hola" }],
    } as never)) as any;

    expect(calls).toHaveLength(1);
    expect(calls[0].endpoint).toBe("responses");
    expect(calls[0].baseURL).toBe("https://api.openai.com/v1");
    expect(calls[0].body).toMatchObject({
      model: "gpt-5.4-mini",
      store: false,
      max_output_tokens: 400,
      reasoning: { effort: "high" },
      input: [{ role: "user", content: "hola" }],
    });
    expect(calls[0].body).not.toHaveProperty("temperature");
    expect(out.choices[0].message.content).toBe("Hola humano");
  });

  it("un cliente BYOK de otro proveedor sigue por chat (sin cambios)", async () => {
    const { createGovernedClient } = await import("@/lib/llm/governance");
    const client = createGovernedClient({
      provider: "gemini",
      apiKey: "gm-tenant",
      defaultEffort: () => "high",
    });

    await client.chat.completions.create({
      model: "gemini-3.5-flash",
      temperature: 0.2,
      messages: [{ role: "user", content: "hola" }],
    } as never);

    expect(calls[0].endpoint).toBe("chat");
    expect(calls[0].body).toEqual({
      model: "gemini-3.5-flash",
      messages: [{ role: "user", content: "hola" }],
      reasoning_effort: "high",
    });
  });
});
