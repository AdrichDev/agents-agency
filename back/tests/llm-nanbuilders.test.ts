/**
 * nanBuilders como proveedor LLM INTERNO (OpenAI-compatible), con el mismo patrón que
 * OpenAI/Gemini/Anthropic: el modelo elegido decide el proveedor por prefijo, el operador
 * trae su clave y, si algún día hace falta, cada tenant puede traer la suya (BYOK).
 *
 * Decisión del propietario: es un proveedor **interno** — branding, estudios de mercado y
 * landings. Nada de datos de clientes finales sale por aquí salvo que alguien elija
 * explícitamente un modelo `nan*`/`nb*` para un agente de cliente.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  PROVIDER_BASE_URL,
  PROVIDER_LABEL,
  LLM_PROVIDER_IDS,
  providerForModel,
  createGovernedClient,
  nanBuildersBaseUrl,
} from "@/lib/llm/governance";

const saved = { base: process.env.NANBUILDERS_BASE_URL, prefixes: process.env.NANBUILDERS_MODEL_PREFIXES };
beforeEach(() => {
  process.env.NANBUILDERS_BASE_URL = "https://api.nanbuilders.example/v1";
  delete process.env.NANBUILDERS_MODEL_PREFIXES;
});
afterEach(() => {
  if (saved.base === undefined) delete process.env.NANBUILDERS_BASE_URL;
  else process.env.NANBUILDERS_BASE_URL = saved.base;
  if (saved.prefixes === undefined) delete process.env.NANBUILDERS_MODEL_PREFIXES;
  else process.env.NANBUILDERS_MODEL_PREFIXES = saved.prefixes;
});

describe("catálogo de proveedores", () => {
  it("nanBuilders está en el catálogo con su etiqueta y su base URL", () => {
    expect(LLM_PROVIDER_IDS).toContain("nanbuilders");
    expect(PROVIDER_LABEL.nanbuilders).toBe("nanBuilders");
    expect(PROVIDER_BASE_URL.nanbuilders).toBe("https://api.nanbuilders.example/v1");
  });

  it("sin NANBUILDERS_BASE_URL no hay destino: no se cae a OpenAI por accidente", () => {
    delete process.env.NANBUILDERS_BASE_URL;
    expect(nanBuildersBaseUrl()).toBeNull();
    expect(PROVIDER_BASE_URL.nanbuilders).toBeUndefined();
  });
});

describe("routing por prefijo del modelo", () => {
  it("los modelos nan*/nb* van a nanBuilders", () => {
    expect(providerForModel("nan-llama-70b")).toBe("nanbuilders");
    expect(providerForModel("nb/qwen-32b")).toBe("nanbuilders");
    expect(providerForModel("nanbuilders-chat")).toBe("nanbuilders");
  });

  it("los proveedores de siempre no cambian (regresión)", () => {
    expect(providerForModel("gpt-5.4")).toBe("openai");
    expect(providerForModel("gemini-3.5-flash")).toBe("gemini");
    expect(providerForModel("claude-sonnet-4")).toBe("anthropic");
    expect(providerForModel(undefined)).toBe("openai");
  });

  it("los prefijos se pueden redefinir por entorno", () => {
    process.env.NANBUILDERS_MODEL_PREFIXES = "nx-,custom";
    expect(providerForModel("nx-1")).toBe("nanbuilders");
    expect(providerForModel("custom-model")).toBe("nanbuilders");
    expect(providerForModel("nan-llama")).toBe("openai"); // ya no es un prefijo
  });
});

describe("cliente gobernado", () => {
  it("usa la base URL de nanBuilders", () => {
    const client = createGovernedClient({ provider: "nanbuilders", apiKey: "clave-de-prueba" });
    expect(client.baseURL).toContain("api.nanbuilders.example");
  });

  it("pedir nanBuilders sin base URL falla con un mensaje accionable (no manda nada a otro lado)", () => {
    delete process.env.NANBUILDERS_BASE_URL;
    expect(() => createGovernedClient({ provider: "nanbuilders", apiKey: "x" })).toThrow(
      /NANBUILDERS_BASE_URL/,
    );
  });
});
