/**
 * S4 (model-catalog, T3) — DeepSeek como proveedor de primera clase en el back de AA.
 *
 * DeepSeek entra con el MISMO contrato que los otros proveedores OpenAI-compatibles, y este
 * fichero comprueba las cuatro cosas que lo definen, cada una por separado:
 *
 *   1. **Catálogo**: existe como proveedor (`LLM_PROVIDER_IDS`), con etiqueta "DeepSeek" y base
 *      `https://api.deepseek.com` — la que publica la doc oficial de DeepSeek para el SDK de
 *      OpenAI, sin `/v1` (el SDK le añade `/chat/completions` y `/models`).
 *   2. **Routing**: los ids `deepseek*` van a DeepSeek y NUNCA por `/v1/responses` (S5: Responses
 *      es sólo del proveedor OpenAI). Los otros prefijos no cambian: es la prueba de regresión
 *      del helper compartido, porque `providerForModel` decide también qué credencial BYOK se usa.
 *   3. **Cliente**: tanto el global de plataforma (`lib/openai.ts`, clave `DEEPSEEK_API_KEY`) como
 *      el BYOK (`createGovernedClient`, clave del tenant) mandan `chat.completions` a
 *      `api.deepseek.com`; y `verifyApiKey` verifica con `models.list()`, sin gastar tokens.
 *   4. **Gobernanza**: el effort sale del catálogo vivo, igual que en el resto (DeepSeek acepta
 *      `reasoning_effort` con valores `none|low|high|max` según su doc oficial; `minimal` se
 *      mapea a `low` y `medium`/`xhigh` a `high` en su lado, así que lo que mandamos —sólo
 *      niveles presentes en `thinkingLevelMap`— siempre cae dentro).
 *
 * Sin red: el SDK `openai` está mockeado y el catálogo se refresca con un `http` inyectado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Recorded = {
  endpoint: "chat" | "responses" | "models";
  baseURL: string;
  apiKey?: string;
  body?: any;
};
const calls: Recorded[] = [];
/** Estado compartido con el doble del SDK (vi.hoisted: el mock se eleva sobre los imports). */
const state = vi.hoisted(() => ({ modelsError: null as string | null }));

const CHAT_REPLY = { choices: [{ message: { content: "ok" } }], usage: { total_tokens: 1 } };

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    baseURL: string;
    apiKey: string;
    chat: { completions: { create: (body: any) => Promise<unknown> } };
    responses: { create: (body: any) => Promise<unknown> };
    models: { list: () => Promise<unknown> };
    constructor(opts: { apiKey?: string; baseURL?: string }) {
      this.baseURL = opts.baseURL ?? "https://api.openai.com/v1";
      this.apiKey = opts.apiKey ?? "";
      this.chat = {
        completions: {
          create: async (body: any) => {
            calls.push({ endpoint: "chat", baseURL: this.baseURL, apiKey: this.apiKey, body });
            return CHAT_REPLY;
          },
        },
      };
      // S5: el SDK real expone `/v1/responses`; el doble tiene que exponerla para poder afirmar
      // que DeepSeek NO pasa por ahí.
      this.responses = {
        create: async (body: any) => {
          calls.push({ endpoint: "responses", baseURL: this.baseURL, apiKey: this.apiKey, body });
          return { id: "resp_1", output: [] };
        },
      };
      this.models = {
        list: async () => {
          calls.push({ endpoint: "models", baseURL: this.baseURL, apiKey: this.apiKey });
          if (state.modelsError) throw new Error(state.modelsError);
          return { data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }] };
        },
      };
    }
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: { systemConfig: { findUnique: vi.fn(async () => null) } },
}));
// Evita que `dotenv.config()` de lib/openai.ts lea el .env real.
vi.mock("dotenv", () => ({ default: { config: vi.fn() }, config: vi.fn() }));

import {
  LLM_PROVIDER_IDS,
  PROVIDER_BASE_URL,
  PROVIDER_LABEL,
  createGovernedClient,
  governChatBody,
  isLlmProviderId,
  providerForModel,
  usesResponsesApi,
} from "@/lib/llm/governance";
import { verifyApiKey } from "@/lib/llm/credentials";
import { resetModelCatalog } from "@/lib/llm/catalog";
import {
  PI_DEV_MODELS_BASE,
  buildCatalogResponse,
  refreshModelCatalog,
  type CatalogHttp,
} from "@/lib/llm/catalog-sources";

/** Respuesta real de pi.dev para DeepSeek (recortada a lo que se usa). */
const DEEPSEEK_FLASH = {
  id: "deepseek-flash",
  name: "DeepSeek V4.1 Flash",
  api: "openai-completions",
  provider: "deepseek",
  reasoning: true,
  type: "chat",
  contextWindow: 1000000,
  cost: { input: 0.3, output: 1.2 },
  thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" },
};

const DEEPSEEK_V4_PRO = {
  id: "deepseek-v4-pro",
  name: "DeepSeek V4 Pro",
  api: "openai-completions",
  provider: "deepseek",
  reasoning: true,
  type: "chat",
  contextWindow: 1000000,
  cost: { input: 1.32, output: 3.96 },
  thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" },
};

/** pi.dev sólo responde por DeepSeek; el resto falla (fail-soft, sin tocar red). */
const piDev = (payload: unknown) => async (url: string) =>
  url === `${PI_DEV_MODELS_BASE}/deepseek?types=chat`
    ? { status: 200, etag: '"deepseek-v1"', body: payload }
    : { status: 404, etag: null, body: null };

const SAVED = { ...process.env };

async function loadPlatformClient() {
  vi.resetModules();
  return (await import("@/lib/openai")).openai;
}

beforeEach(() => {
  calls.length = 0;
  state.modelsError = null;
  resetModelCatalog();
  process.env = { ...SAVED };
  process.env.OPENAI_API_KEY = "sk-plataforma-openai";
  process.env.DEEPSEEK_API_KEY = "sk-deepseek-plataforma";
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.NANBUILDERS_API_KEY;
  delete process.env.NANBUILDERS_BASE_URL;
  delete process.env.NANBUILDERS_MODEL_PREFIXES;
});

afterEach(() => {
  process.env = { ...SAVED };
  resetModelCatalog();
});

describe("S4 — DeepSeek está en el catálogo de proveedores", () => {
  it("tiene id propio, etiqueta y base URL de su doc oficial (sin `/v1`)", () => {
    expect(LLM_PROVIDER_IDS).toContain("deepseek");
    expect(PROVIDER_LABEL.deepseek).toBe("DeepSeek");
    // `https://api.deepseek.com` es el `base_url` que documenta DeepSeek para el SDK de OpenAI;
    // el SDK le añade `/chat/completions`. `/v1` también lo acepta, pero sobra.
    expect(PROVIDER_BASE_URL.deepseek).toBe("https://api.deepseek.com");
  });

  it("es un proveedor válido para el borde (BYOK) y deepseek no colisiona con nanBuilders", () => {
    expect(isLlmProviderId("deepseek")).toBe(true);
    expect(providerForModel("deepseek-flash")).toBe("deepseek");
  });
});

describe("S4 — routing por prefijo `deepseek`", () => {
  const casos: Array<[string, string]> = [
    ["deepseek-flash", "deepseek"],
    ["deepseek-v4-pro", "deepseek"],
    ["DeepSeek-V4-Pro", "deepseek"],
    // PRESERVE: los prefijos que ya existían no cambian. `providerForModel` también decide qué
    // credencial BYOK se busca, así que un cambio aquí sería la clave equivocada.
    ["gpt-5.4", "openai"],
    ["gpt-4o-mini", "openai"],
    ["gemini-3.5-flash", "gemini"],
    ["claude-opus-5", "anthropic"],
    ["nan/glm5.3-flash", "nanbuilders"],
    ["modelo-inventado", "openai"],
  ];

  it.each(casos)("%s → %s", (model, esperado) => {
    expect(providerForModel(model)).toBe(esperado);
  });

  it("DeepSeek NO va por la Responses API (eso es sólo del proveedor OpenAI)", () => {
    expect(usesResponsesApi("deepseek-v4-pro")).toBe(false);
    expect(usesResponsesApi("deepseek-flash")).toBe(false);
    // PRESERVE: la regla de S5 sigue en pie para OpenAI.
    expect(usesResponsesApi("gpt-5.4-mini")).toBe(true);
  });
});

describe("S4 — el cliente global de plataforma manda DeepSeek a su API, por chat.completions", () => {
  it("usa api.deepseek.com con DEEPSEEK_API_KEY y NUNCA /v1/responses", async () => {
    const client = await loadPlatformClient();
    await client.chat.completions.create({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hola" }],
    } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      endpoint: "chat",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-deepseek-plataforma",
    });
  });

  it("sin DEEPSEEK_API_KEY falla cerrado, en vez de mandar el modelo a otro proveedor", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const client = await loadPlatformClient();

    const attempt = Promise.resolve().then(() =>
      client.chat.completions.create({ model: "deepseek-flash", messages: [] } as never)
    );

    await expect(attempt).rejects.toMatchObject({ status: 503, code: "LLM_PROVIDER_NOT_CONFIGURED" });
    await expect(attempt).rejects.toThrow(/DEEPSEEK_API_KEY/);
    expect(calls).toEqual([]);
  });

  it("PRESERVE: los modelos gpt* siguen saliendo por /v1/responses de OpenAI", async () => {
    const client = await loadPlatformClient();
    await client.chat.completions.create({ model: "gpt-5.4-mini", messages: [] } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ endpoint: "responses", baseURL: "https://api.openai.com/v1" });
  });
});

describe("S4 — BYOK: la clave del cliente también va a DeepSeek", () => {
  it("createGovernedClient construye el cliente en la base de DeepSeek y por chat.completions", async () => {
    const client = createGovernedClient({ provider: "deepseek", apiKey: "sk-cliente-deepseek-1234" });
    await client.chat.completions.create({ model: "deepseek-flash", messages: [] } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      endpoint: "chat",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-cliente-deepseek-1234",
    });
  });

  it("verifyApiKey verifica con models.list() contra DeepSeek, sin gastar tokens", async () => {
    const result = await verifyApiKey("deepseek", "sk-cliente-deepseek-1234");

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      endpoint: "models",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-cliente-deepseek-1234",
    });
  });

  it("una clave que DeepSeek rechaza no se da por buena, y el motivo no repite la clave", async () => {
    state.modelsError = "Incorrect API key provided: sk-cliente-deepseek-1234";

    const result = await verifyApiKey("deepseek", "sk-cliente-deepseek-1234");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("sk-cliente-deepseek-1234");
      expect(result.error).toContain("***1234");
    }
  });
});

describe("S4 + S6 — el effort de DeepSeek sale del catálogo vivo", () => {
  it("el catálogo publica DeepSeek con la etiqueta de PROVIDER_LABEL y sus efforts", async () => {
    await refreshModelCatalog({
      http: piDev([DEEPSEEK_FLASH, DEEPSEEK_V4_PRO]) as CatalogHttp,
      env: {},
    });

    const deepseek = buildCatalogResponse().providers.find((p) => p.id === "deepseek");

    // La etiqueta sale de PROVIDER_LABEL, no de una copia local: dos tablas acaban divergiendo.
    expect(deepseek?.name).toBe(PROVIDER_LABEL.deepseek);
    expect(deepseek?.models.map((m) => m.id)).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    expect(deepseek?.models.every((m) => m.provider === "deepseek")).toBe(true);
    // pi.dev declara `low/high/Max`; `max` no se ofrece porque el back no lo sabe mandar.
    expect(deepseek?.models[0].efforts).toEqual(["low", "high"]);
    expect(deepseek?.models[0].defaultEffort).toBe("low");
    expect(deepseek?.models[1].efforts).toEqual(["high"]);
  });

  it("un razonador de DeepSeek recibe su effort del catálogo y pierde temperature", async () => {
    await refreshModelCatalog({
      http: piDev([DEEPSEEK_FLASH, DEEPSEEK_V4_PRO]) as CatalogHttp,
      env: {},
    });

    const flash: any = governChatBody(
      { model: "deepseek-flash", messages: [], temperature: 0.3 },
      "high"
    );
    expect(flash.reasoning_effort).toBe("high");
    expect("temperature" in flash).toBe(false);

    // v4-pro sólo declara `high`: un nivel que no acepta cae a su default, no se manda tal cual.
    const pro: any = governChatBody({ model: "deepseek-v4-pro", messages: [] }, "low");
    expect(pro.reasoning_effort).toBe("high");
  });

  it("DeepSeek se presenta antes que nanBuilders (orden del catálogo)", async () => {
    await refreshModelCatalog({
      http: piDev([DEEPSEEK_FLASH]) as CatalogHttp,
      env: {},
    });

    const ids = buildCatalogResponse().providers.map((p) => p.id);
    const i = ids.indexOf("deepseek");
    expect(i).toBeGreaterThanOrEqual(0);
    if (ids.includes("nanbuilders")) expect(i).toBeLessThan(ids.indexOf("nanbuilders"));
  });
});
