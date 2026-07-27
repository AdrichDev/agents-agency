/**
 * H2 (aa-credenciales-byok-multiproveedor) — T2.1 / T2.2 / T2.3.
 *
 * La gobernanza de `chat.completions` estaba parcheada sobre el singleton global construido con
 * `process.env`, así que sólo se podía comprobar mirando qué acababa llegando al proveedor. Al
 * extraerla a `lib/llm/governance.ts` (pura, sin red, sin env, sin cliente al cargar) se puede
 * probar por TABLA de entradas y salidas — que es el punto de la extracción: el modo BYOK usa la
 * misma función, así que una divergencia entre plataforma y BYOK deja de ser posible.
 *
 * Aquí NO se mockea nada de red: `governChatBody` no la toca. Sólo se mockea el SDK "openai"
 * para `createGovernedClient`, donde lo que se verifica es con qué opciones se instancia y que
 * el `create` quede envuelto.
 */
import { describe, it, expect, vi } from "vitest";

const OpenAICtor = vi.fn();
const rawCreate = vi.fn(async (_body?: any, _opts?: any) => ({ ok: true }));

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    public opts: any;
    public chat = { completions: { create: rawCreate } };
    constructor(opts: any) {
      this.opts = opts;
      OpenAICtor(opts);
    }
  },
}));

import {
  providerForModel,
  governChatBody as governChatBodyTyped,
  createGovernedClient,
  isLlmProviderId,
  PROVIDER_BASE_URL,
  LLM_PROVIDER_IDS,
} from "@/lib/llm/governance";

/**
 * `governChatBody` es genérica y preserva el tipo del body de entrada, así que TypeScript no ve
 * los campos que la propia función AÑADE. En una tabla de entradas/salidas eso sólo estorba:
 * aquí se inspecciona el resultado como dato.
 */
const governChatBody = (body: any, defaultEffort?: string): any =>
  governChatBodyTyped(body, defaultEffort as any);

describe("T2.1 — providerForModel (routing por prefijo)", () => {
  // El booleano `isGeminiModel` que había no podía crecer a tres proveedores; y esta función es
  // además lo que usa el modo BYOK para saber QUÉ credencial del tenant buscar, así que un
  // error aquí no sería un modelo mal ruteado: sería la clave equivocada.
  const casos: Array<[string | null | undefined, string]> = [
    ["gpt-5.4", "openai"],
    ["gpt-4o-mini", "openai"],
    ["gemini-3.5-flash", "gemini"],
    ["gemini-3.1-pro-preview", "gemini"],
    ["claude-opus-5", "anthropic"],
    ["claude-haiku-4-5-20251001", "anthropic"],
    // Desconocido y ausente → "openai": es el comportamiento histórico (el routing anterior
    // mandaba a OpenAI todo lo que no empezara por "gemini").
    ["modelo-inventado", "openai"],
    [undefined, "openai"],
    [null, "openai"],
  ];

  it.each(casos)("%s → %s", (model, esperado) => {
    expect(providerForModel(model)).toBe(esperado);
  });

  it("todos los proveedores del catálogo tienen baseURL declarada (openai = default del SDK)", () => {
    for (const id of LLM_PROVIDER_IDS) expect(id in PROVIDER_BASE_URL).toBe(true);
    expect(PROVIDER_BASE_URL.openai).toBeUndefined();
    expect(PROVIDER_BASE_URL.gemini).toContain("generativelanguage.googleapis.com");
    // Capa de compatibilidad OpenAI de Anthropic, verificada contra su doc oficial.
    expect(PROVIDER_BASE_URL.anthropic).toBe("https://api.anthropic.com/v1/");
  });

  it("isLlmProviderId rechaza lo que llega del borde sin ser un proveedor", () => {
    expect(isLlmProviderId("openai")).toBe(true);
    expect(isLlmProviderId("anthropic")).toBe(true);
    expect(isLlmProviderId("openclaw")).toBe(false);
    expect(isLlmProviderId(undefined)).toBe(false);
    expect(isLlmProviderId(42)).toBe(false);
  });
});

describe("T2.2 — governChatBody (reasoning_effort / temperature)", () => {
  it("modelo razonador sin tools: inyecta el effort por defecto recibido", () => {
    const out = governChatBody({ model: "gpt-5.4", messages: [] }, "high");
    expect(out.reasoning_effort).toBe("high");
  });

  it("el effort del propio body GANA al default (override por agente)", () => {
    const out = governChatBody({ model: "gpt-5.4", messages: [], reasoning_effort: "low" }, "high");
    expect(out.reasoning_effort).toBe("low");
  });

  it("un effort que el modelo no admite cae a su default, no se manda tal cual", () => {
    // gemini-3.1-pro-preview no acepta "xhigh" → su default es "high".
    const out = governChatBody({ model: "gemini-3.1-pro-preview", messages: [] }, "xhigh");
    expect(out.reasoning_effort).toBe("high");
  });

  it("con function tools NUNCA manda effort (ambos proveedores devuelven 400 con effort+tools)", () => {
    const out = governChatBody(
      { model: "gpt-5.4", messages: [], tools: [{ type: "function" }], reasoning_effort: "high" },
      "high"
    );
    expect(out).not.toHaveProperty("reasoning_effort");
  });

  it("modelo NO razonador: borra el effort aunque lo pidan explícitamente", () => {
    const out = governChatBody({ model: "gpt-4o", messages: [], reasoning_effort: "high" }, "high");
    expect(out).not.toHaveProperty("reasoning_effort");
  });

  it("modelo razonador: BORRA temperature (sólo admiten el default, 1)", () => {
    const out = governChatBody({ model: "gpt-5.4", messages: [], temperature: 0.2 }, "medium");
    expect(out).not.toHaveProperty("temperature");
  });

  it("modelo NO razonador: CONSERVA su temperature", () => {
    const out = governChatBody({ model: "gpt-4o", messages: [], temperature: 0.2 }, "medium");
    expect(out.temperature).toBe(0.2);
  });

  // El caso que Anthropic no protestaría: su capa OpenAI-compat ignora en silencio los campos
  // que no entiende, así que un effort mal enviado NO daría 400 — daría otra respuesta. Por eso
  // `claude*` se declara sin efforts y la gobernanza lo quita aquí, sin depender del proveedor.
  it("claude*: borra el effort (declarado sin efforts a propósito) y CONSERVA temperature", () => {
    const out = governChatBody(
      { model: "claude-opus-5", messages: [], reasoning_effort: "high", temperature: 0.3 },
      "high"
    );
    expect(out).not.toHaveProperty("reasoning_effort");
    expect(out.temperature).toBe(0.3);
  });

  it("es pura: no muta el body de entrada", () => {
    const body = { model: "gpt-5.4", messages: [], temperature: 0.2 };
    governChatBody(body, "high");
    expect(body).toEqual({ model: "gpt-5.4", messages: [], temperature: 0.2 });
  });

  it("sin default y sin effort en el body no inventa ninguno", () => {
    const out = governChatBody({ model: "gpt-4o", messages: [] });
    expect(out).not.toHaveProperty("reasoning_effort");
  });
});

describe("T2.3 — createGovernedClient (la MISMA regla en clientes per-tenant)", () => {
  it("instancia con la clave y la baseURL del proveedor pedido", () => {
    OpenAICtor.mockClear();
    createGovernedClient({ provider: "anthropic", apiKey: "sk-ant-cliente" });

    expect(OpenAICtor).toHaveBeenCalledWith({
      apiKey: "sk-ant-cliente",
      baseURL: "https://api.anthropic.com/v1/",
    });
  });

  it("gobierna el body igual que el cliente global (misma función, no una copia)", async () => {
    rawCreate.mockClear();
    const client = createGovernedClient({
      provider: "openai",
      apiKey: "sk-cliente",
      defaultEffort: () => "high",
    });

    await client.chat.completions.create({ model: "gpt-5.4", messages: [], temperature: 0.7 } as any);

    const enviado = rawCreate.mock.calls[0][0] as any;
    expect(enviado.reasoning_effort).toBe("high"); // inyectado
    expect(enviado).not.toHaveProperty("temperature"); // borrado (razonador)
  });

  it("defaultEffort es un thunk: se evalúa en CADA llamada, no al construir", async () => {
    // El effort global es mutable (`refreshModelConfig` lo recarga de la BD). Si se capturara
    // al construir el cliente, un cliente BYOK cacheado seguiría usando el valor viejo tras
    // cambiar la configuración — y el síntoma sería "la config no se aplica a unos clientes".
    rawCreate.mockClear();
    let actual = "low";
    const client = createGovernedClient({
      provider: "openai",
      apiKey: "sk-cliente",
      defaultEffort: () => actual,
    });

    await client.chat.completions.create({ model: "gpt-5.4", messages: [] } as any);
    actual = "xhigh";
    await client.chat.completions.create({ model: "gpt-5.4", messages: [] } as any);

    expect((rawCreate.mock.calls[0][0] as any).reasoning_effort).toBe("low");
    expect((rawCreate.mock.calls[1][0] as any).reasoning_effort).toBe("xhigh");
  });

  it("no se llama a sí mismo: el create original se enlaza ANTES de sobrescribirlo", async () => {
    rawCreate.mockClear();
    const client = createGovernedClient({ provider: "gemini", apiKey: "k" });
    await client.chat.completions.create({ model: "gemini-3.5-flash", messages: [] } as any);
    // Una sola llamada al create RAW: si el wrapper se llamara a sí mismo, esto reventaría por
    // recursión infinita en vez de contar 1.
    expect(rawCreate).toHaveBeenCalledTimes(1);
  });
});
