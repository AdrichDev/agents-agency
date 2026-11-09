/**
 * S4 corregido (model-catalog, T6) — DeepSeek NO es un proveedor directo: entra por nanBuilders.
 *
 * Corrección del propietario: "Te he dicho varias veces que deepseek entra porque va de la mando
 * de nanBuilders!". DeepSeek no tiene clave propia, ni base URL propia, ni lista de pi.dev, ni
 * slot BYOK. Lo que sí tiene son modelos que nanBuilders sirve, y que por tanto aparecen en el
 * catálogo con el id que enruta a nanBuilders (`nan/deepseek-…`).
 *
 * Lo que se comprueba aquí, y por qué:
 *
 *   1. **No existe como proveedor**: ni en `LLM_PROVIDER_IDS`, ni en `PROVIDER_BASE_URL`, ni en
 *      `PROVIDER_LABEL`, ni en el catálogo. Es la lista que decide qué credencial BYOK se busca y
 *      qué esfuerzo se ofrece: un proveedor que sobrevive en una tabla y no en las demás es un
 *      panel que ofrece algo que el back no sabe servir (el fallo que se vio en producción).
 *   2. **pi.dev no se consulta para DeepSeek**: pedir su lista era lo que metía sus modelos como
 *      modelos de un proveedor propio.
 *   3. **Llegan como modelos de nanBuilders**: un `/models` de nanBuilders que devuelva
 *      `deepseek-v4-flash` produce `nan/deepseek-v4-flash` bajo el proveedor `nanbuilders`, y ese
 *      id vuelve a rutar a nanBuilders.
 *   4. **Un id suelto no se puede elegir**: `deepseek-v4-pro` cae en el proveedor por defecto al
 *      enrutar (comportamiento histórico de todo id desconocido) y el catálogo lo rechaza al
 *      elegirlo, así que el usuario no puede quedarse con un modelo que no se sirve.
 *
 * Sin red: el `http` del refresco se inyecta. No se importa `lib/openai.ts` (no hay cliente que
 * probar aquí): el enrutado y el catálogo son datos y funciones puras.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LLM_PROVIDER_IDS,
  PROVIDER_BASE_URL,
  PROVIDER_LABEL,
  isLlmProviderId,
  providerForModel,
  usesResponsesApi,
} from "@/lib/llm/governance";
import { CATALOG_PROVIDER_IDS, catalogModelById, resetModelCatalog } from "@/lib/llm/catalog";
import {
  PI_DEV_MODELS_BASE,
  assertSelectableModel,
  buildCatalogResponse,
  catalogModelRejection,
  isCatalogModel,
  refreshModelCatalog,
  routableNanBuildersId,
  type CatalogHttp,
} from "@/lib/llm/catalog-sources";

const NB_BASE = "https://nb.test/v1";
const NB_MODELS_URL = `${NB_BASE}/models`;

interface Peticion {
  url: string;
  headers: Record<string, string>;
}

/**
 * `http` inyectable que apunta cada llamada y responde con lo que se le diga. Los proveedores no
 * declarados responden 404: así el refresco no toca red ni depende del orden de los tests.
 */
function fakeHttp(routes: Record<string, { status?: number; etag?: string | null; body?: unknown }>): {
  http: CatalogHttp;
  pedidas: Peticion[];
} {
  const pedidas: Peticion[] = [];
  return {
    pedidas,
    http: async (url, init) => {
      pedidas.push({ url, headers: init.headers });
      const route = routes[url];
      if (!route) return { status: 404, etag: null, body: null };
      return { status: route.status ?? 200, etag: route.etag ?? null, body: route.body ?? null };
    },
  };
}

const NB_ENV = { NANBUILDERS_BASE_URL: NB_BASE, NANBUILDERS_API_KEY: "nb-key" };

const saved = { base: process.env.NANBUILDERS_BASE_URL, prefixes: process.env.NANBUILDERS_MODEL_PREFIXES };
beforeEach(() => {
  resetModelCatalog();
  process.env.NANBUILDERS_BASE_URL = NB_BASE;
  delete process.env.NANBUILDERS_MODEL_PREFIXES;
});
afterEach(() => {
  resetModelCatalog();
  if (saved.base === undefined) delete process.env.NANBUILDERS_BASE_URL;
  else process.env.NANBUILDERS_BASE_URL = saved.base;
  if (saved.prefixes === undefined) delete process.env.NANBUILDERS_MODEL_PREFIXES;
  else process.env.NANBUILDERS_MODEL_PREFIXES = saved.prefixes;
});

describe("S4 — DeepSeek no es un proveedor del back", () => {
  it("los proveedores son exactamente OpenAI, Gemini, Anthropic y nanBuilders", () => {
    expect(LLM_PROVIDER_IDS).toEqual(["openai", "gemini", "anthropic", "nanbuilders"]);
    expect(CATALOG_PROVIDER_IDS).toEqual(["openai", "gemini", "anthropic", "nanbuilders"]);
  });

  it("no tiene base URL ni etiqueta propias", () => {
    expect(Object.keys(PROVIDER_BASE_URL)).not.toContain("deepseek");
    expect(Object.keys(PROVIDER_LABEL)).not.toContain("deepseek");
  });

  it("no es un proveedor válido para el borde (BYOK)", () => {
    expect(isLlmProviderId("deepseek")).toBe(false);
    expect(isLlmProviderId("nanbuilders")).toBe(true);
  });

  it("el catálogo servido no presenta ningún proveedor `deepseek`", () => {
    const ids = buildCatalogResponse().providers.map((p) => p.id);

    expect(ids).not.toContain("deepseek");
    expect(ids).toEqual(["openai", "gemini", "anthropic"]);
  });
});

describe("S4 — pi.dev nunca se consulta para `deepseek`", () => {
  it("el refresco pide exactamente las listas de los proveedores ofrecidos", async () => {
    const { http, pedidas } = fakeHttp({});

    await refreshModelCatalog({ http, env: {} });

    expect(pedidas.map((p) => p.url)).toEqual([
      `${PI_DEV_MODELS_BASE}/openai?types=chat`,
      `${PI_DEV_MODELS_BASE}/google?types=chat`,
      `${PI_DEV_MODELS_BASE}/anthropic?types=chat`,
    ]);
    expect(pedidas.some((p) => p.url.includes("deepseek"))).toBe(false);
  });

  it("con todo respondiendo, el catálogo sigue sin proveedor `deepseek`", async () => {
    const { http } = fakeHttp({
      [`${PI_DEV_MODELS_BASE}/openai?types=chat`]: {
        body: [{ id: "gpt-5.4-mini", name: "GPT-5.4 mini", type: "chat", provider: "openai" }],
      },
      [`${PI_DEV_MODELS_BASE}/google?types=chat`]: {
        body: [{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", type: "chat", provider: "google" }],
      },
      [`${PI_DEV_MODELS_BASE}/anthropic?types=chat`]: {
        body: [{ id: "claude-opus-5", name: "Claude Opus 5", type: "chat", provider: "anthropic" }],
      },
      [NB_MODELS_URL]: { body: { data: [{ id: "glm5.3-flash" }] } },
    });

    await refreshModelCatalog({ http, env: NB_ENV });

    // Los proveedores presentados son los cuatro, en el orden del catálogo, y ninguno más.
    expect(buildCatalogResponse().providers.map((p) => p.id)).toEqual([
      "openai",
      "gemini",
      "anthropic",
      "nanbuilders",
    ]);
  });
});

describe("S4 — los modelos DeepSeek llegan como modelos de nanBuilders", () => {
  it("un `/models` de nanBuilders con deepseek-* produce ids `nan/deepseek-*` que enrutan allí", async () => {
    const { http, pedidas } = fakeHttp({
      [NB_MODELS_URL]: {
        body: { data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }] },
      },
    });

    await refreshModelCatalog({ http, env: NB_ENV });

    const nb = buildCatalogResponse().providers.find((p) => p.id === "nanbuilders");
    expect(nb?.models.map((m) => m.id)).toEqual(["nan/deepseek-v4-flash", "nan/deepseek-v4-pro"]);
    expect(nb?.models.every((m) => m.provider === "nanbuilders")).toBe(true);
    // Lo que importa de verdad: el id ofrecido vuelve a nanBuilders al llamar al modelo.
    for (const modelo of nb!.models) expect(providerForModel(modelo.id)).toBe("nanbuilders");
    expect(providerForModel("nan/deepseek-v4-flash")).toBe("nanbuilders");
    // El id se ofrece con el prefijo que se enviará al proveedor, y se pide con la clave de
    // plataforma de nanBuilders (no hay ninguna clave de DeepSeek en juego).
    expect(routableNanBuildersId("deepseek-v4-flash")).toBe("nan/deepseek-v4-flash");
    expect(pedidas.find((p) => p.url === NB_MODELS_URL)?.headers.authorization).toBe("Bearer nb-key");
    expect(pedidas.some((p) => p.url.includes("deepseek"))).toBe(false);
  });

  it("ese id es elegible; el id DeepSeek suelto, no", async () => {
    const { http } = fakeHttp({
      [NB_MODELS_URL]: { body: { data: [{ id: "deepseek-v4-flash" }] } },
    });

    await refreshModelCatalog({ http, env: NB_ENV });

    expect(catalogModelById("nan/deepseek-v4-flash")?.provider).toBe("nanbuilders");
    expect(isCatalogModel("nan/deepseek-v4-flash")).toBe(true);
    expect(isCatalogModel("deepseek-v4-flash")).toBe(false);
  });
});

describe("S4 — un id DeepSeek suelto cae en el proveedor por defecto y se rechaza al elegirlo", () => {
  it("`deepseek-v4-pro` no rutea a ningún proveedor propio", () => {
    // Ya no hay prefijo `deepseek`: el id es desconocido y cae en el default histórico (OpenAI).
    // Se documenta la consecuencia, que es visible: por eso el catálogo lo rechaza justo debajo.
    expect(providerForModel("deepseek-v4-pro")).toBe("openai");
    expect(providerForModel("DeepSeek-V4-Pro")).toBe("openai");
    expect(usesResponsesApi("deepseek-v4-pro")).toBe(true);
    // PRESERVE: lo que sí va a nanBuilders (con su prefijo) sigue sin pasar por Responses.
    expect(usesResponsesApi("nan/deepseek-v4-flash")).toBe(false);
  });

  it("PRESERVE: el resto de prefijos no cambia", () => {
    const casos: Array<[string, string]> = [
      ["gpt-5.4", "openai"],
      ["gpt-4o-mini", "openai"],
      ["gemini-3.5-flash", "gemini"],
      ["claude-opus-5", "anthropic"],
      ["nan/glm5.3-flash", "nanbuilders"],
      ["nb/qwen-32b", "nanbuilders"],
      ["modelo-inventado", "openai"],
    ];

    for (const [model, esperado] of casos) expect(providerForModel(model)).toBe(esperado);
    expect(usesResponsesApi("gpt-5.4-mini")).toBe(true);
    expect(usesResponsesApi("gemini-3.5-flash")).toBe(false);
  });

  it("sin catálogo vivo tampoco está en la tabla de respaldo", () => {
    expect(isCatalogModel("deepseek-v4-pro")).toBe(false);
    expect(isCatalogModel("deepseek-v4-flash")).toBe(false);
  });

  it("con catálogo vivo, el rechazo es un 400 accionable y no toca el catálogo", async () => {
    const { http } = fakeHttp({
      [`${PI_DEV_MODELS_BASE}/openai?types=chat`]: {
        body: [{ id: "gpt-5.4-mini", name: "GPT-5.4 mini", type: "chat" }],
      },
      [NB_MODELS_URL]: { body: { data: [{ id: "deepseek-v4-flash" }] } },
    });
    await refreshModelCatalog({ http, env: NB_ENV });

    const rechazo = catalogModelRejection("deepseek-v4-pro");
    expect(rechazo?.status).toBe(400);
    expect((rechazo as any)?.code).toBe("MODEL_NOT_IN_CATALOG");
    expect(() => assertSelectableModel("deepseek-v4-pro")).toThrow(/no está en el catálogo vivo/);

    // El id que sí se sirve no se rechaza: el catálogo no está prohibiendo DeepSeek, está
    // prohibiendo el id que no enruta a quien lo sirve.
    expect(catalogModelRejection("nan/deepseek-v4-flash")).toBeNull();
    expect(() => assertSelectableModel("nan/deepseek-v4-flash")).not.toThrow();
  });
});
