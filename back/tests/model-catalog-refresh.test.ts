/**
 * S1, S2 y S3 (model-catalog, T1) — refresco del catálogo vivo.
 *
 * El refresco tiene que cumplir cuatro reglas que sólo se ven ejecutándolo:
 *   1. Mapea el proveedor `google` de pi.dev a nuestro id `gemini` (S1).
 *   2. Manda `if-none-match` con el etag guardado y un 304 no cambia nada (S1).
 *   3. Si pi.dev falla, se conserva la última lista buena; si nunca hubo una, se usa la tabla
 *      estática (`model-capabilities.ts`) como respaldo (S1).
 *   4. Cruza la lista con `/models` del proveedor cuando hay clave de plataforma y sólo deja los
 *      ids que el proveedor sirve (S2); sin clave no filtra y lo marca `verified: false`.
 *
 * Y una más, propia de S3: NanBuilders aporta TODOS sus modelos, con el id que enruta a él
 * (`providerForModel`), y desaparece sin ruido cuando no está configurado.
 *
 * Nada de red: `refreshModelCatalog` recibe el `http` y el entorno por parámetro, así que estas
 * pruebas no dependen de que pi.dev o OpenAI estén arriba.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  catalogModelById,
  liveCatalogProviders,
  resetModelCatalog,
} from "@/lib/llm/catalog";
import {
  PI_DEV_MODELS_BASE,
  buildCatalogResponse,
  isCatalogModel,
  refreshModelCatalog,
  routableNanBuildersId,
  type CatalogHttp,
} from "@/lib/llm/catalog-sources";
import { MODEL_CAPABILITIES } from "@/lib/model-capabilities";
import { providerForModel } from "@/lib/llm/governance";

/** Cuerpo de pi.dev para un razonador de OpenAI. */
const GPT54_MINI = {
  id: "gpt-5.4-mini",
  name: "GPT-5.4 mini",
  provider: "openai",
  reasoning: true,
  type: "chat",
  contextWindow: 400000,
  cost: { input: 0.25, output: 2 },
  thinkingLevelMap: { off: "none", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
};

/**
 * pi.dev NUNCA borra modelos: sigue listando `gpt-4.1-nano`, que OpenAI retiró con 404. Es el
 * caso que obliga al cruce con `/models` del proveedor (S2).
 */
const GPT41_NANO = {
  id: "gpt-4.1-nano",
  name: "GPT-4.1 nano",
  provider: "openai",
  reasoning: false,
  type: "chat",
  contextWindow: 1047576,
};

const GEMINI_FLASH = {
  id: "gemini-3.5-flash",
  name: "Gemini 3.5 Flash",
  provider: "google",
  reasoning: true,
  type: "chat",
  contextWindow: 1000000,
  thinkingLevelMap: { minimal: "minimal", low: "low", medium: "medium", high: "high" },
};

const piUrl = (slug: string) => `${PI_DEV_MODELS_BASE}/${slug}?types=chat`;
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

interface FakeRoute {
  status?: number;
  etag?: string | null;
  body?: unknown;
}

/** `http` falso: responde por URL exacta y apunta lo que se le pidió (url + cabeceras). */
function fakeHttp(routes: Record<string, FakeRoute>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const http: CatalogHttp = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const route = routes[url];
    if (!route) return { status: 404, etag: null, body: null };
    return { status: route.status ?? 200, etag: route.etag ?? '"etag-1"', body: route.body ?? null };
  };
  return { http, calls };
}

beforeEach(() => {
  resetModelCatalog();
});

describe("S1 — pi.dev es la fuente, y google es nuestro gemini", () => {
  it("mapea `/providers/google` a nuestro proveedor `gemini`", async () => {
    const { http, calls } = fakeHttp({ [piUrl("google")]: { body: [GEMINI_FLASH] } });

    await refreshModelCatalog({ http, env: {} });

    expect(calls.map((c) => c.url)).toContain(piUrl("google"));
    // El proveedor `gemini` sale con su etiqueta de `governance.ts` (no inventada aquí) y con los
    // modelos ya traducidos. Los demás proveedores que pi.dev no contestó conservan el respaldo
    // estático: el respaldo es POR proveedor, no global.
    expect(buildCatalogResponse().providers.find((p) => p.id === "gemini")).toEqual({
      id: "gemini",
      name: "Google Gemini",
      models: [
        {
          id: "gemini-3.5-flash",
          name: "Gemini 3.5 Flash",
          provider: "gemini",
          reasoning: true,
          efforts: ["minimal", "low", "medium", "high"],
          defaultEffort: "low",
          contextWindow: 1000000,
          verified: false,
        },
      ],
    });
    expect(catalogModelById("gemini-3.5-flash")?.provider).toBe("gemini");
  });

  it("pide el catálogo con `accept: application/json` y el filtro de tipos de chat", async () => {
    const { http, calls } = fakeHttp({ [piUrl("anthropic")]: { body: [] } });

    await refreshModelCatalog({ http, env: {} });

    const call = calls.find((c) => c.url === piUrl("anthropic"));
    expect(call?.url).toBe(`${PI_DEV_MODELS_BASE}/anthropic?types=chat`);
    expect(call?.headers.accept).toBe("application/json");
  });

  it("una respuesta sin precio no mete ningún `cost` en el catálogo", async () => {
    const { http } = fakeHttp({ [piUrl("openai")]: { body: [GPT54_MINI, GPT41_NANO] } });

    await refreshModelCatalog({ http, env: {} });

    expect(JSON.stringify(buildCatalogResponse())).not.toMatch(/cost/i);
  });
});

describe("S1 — etag y 304", () => {
  it("la segunda pasada manda `if-none-match` y un 304 conserva la lista", async () => {
    const primera = fakeHttp({ [piUrl("openai")]: { body: [GPT54_MINI], etag: '"v1"' } });
    await refreshModelCatalog({ http: primera.http, env: {} });
    expect(primera.calls.find((c) => c.url === piUrl("openai"))?.headers["if-none-match"]).toBeUndefined();

    const segunda = fakeHttp({ [piUrl("openai")]: { status: 304, etag: '"v1"' } });
    const resumen = await refreshModelCatalog({ http: segunda.http, env: {} });

    expect(segunda.calls.find((c) => c.url === piUrl("openai"))?.headers["if-none-match"]).toBe('"v1"');
    expect(resumen.unchanged).toContain("openai");
    expect(catalogModelById("gpt-5.4-mini")?.id).toBe("gpt-5.4-mini");
  });
});

describe("S1 — respaldo: última lista buena, y si nunca hubo, la tabla estática", () => {
  it("si pi.dev falla se conserva la última lista buena del proveedor", async () => {
    const primera = fakeHttp({ [piUrl("openai")]: { body: [GPT54_MINI] } });
    await refreshModelCatalog({ http: primera.http, env: {} });

    const caida = fakeHttp({ [piUrl("openai")]: { status: 500 } });
    const resumen = await refreshModelCatalog({ http: caida.http, env: {} });

    expect(resumen.failed).toContain("openai");
    expect(catalogModelById("gpt-5.4-mini")?.id).toBe("gpt-5.4-mini");
    expect(liveCatalogProviders().map((p) => p.id)).toContain("openai");
  });

  it("sin ningún refresco correcto, el catálogo es la tabla estática actual", async () => {
    const { providers } = buildCatalogResponse();

    const openai = providers.find((p) => p.id === "openai");
    expect(openai?.models.map((m) => m.id)).toEqual(expect.arrayContaining(["gpt-5.6-luna", "gpt-5.4-mini"]));
    // Sin cruce con el proveedor no se puede afirmar que el modelo siga vivo.
    expect(openai?.models.every((m) => m.verified === false)).toBe(true);
    // La tabla estática es la de siempre, no una copia: mismos ids y mismos efforts.
    expect(Object.keys(MODEL_CAPABILITIES)).toEqual(expect.arrayContaining(openai!.models.map((m) => m.id)));
    const luna = openai?.models.find((m) => m.id === "gpt-5.6-luna");
    expect(luna?.defaultEffort).toBe("low");
    expect(luna?.reasoning).toBe(true);
  });
});

describe("S2 — solo modelos vivos", () => {
  it("con clave de OpenAI, el cruce con /v1/models quita los ids que el proveedor ya no sirve", async () => {
    const { http, calls } = fakeHttp({
      [piUrl("openai")]: { body: [GPT54_MINI, GPT41_NANO] },
      [OPENAI_MODELS_URL]: { body: { object: "list", data: [{ id: "gpt-5.4-mini" }] } },
    });

    await refreshModelCatalog({ http, env: { OPENAI_API_KEY: "sk-test" } });

    expect(catalogModelById("gpt-4.1-nano")).toBeUndefined();
    expect(catalogModelById("gpt-5.4-mini")?.verified).toBe(true);
    expect(calls.find((c) => c.url === OPENAI_MODELS_URL)?.headers.authorization).toBe("Bearer sk-test");
  });

  it("sin clave de plataforma NO se filtra y el modelo se marca `verified: false`", async () => {
    const { http, calls } = fakeHttp({ [piUrl("openai")]: { body: [GPT54_MINI, GPT41_NANO] } });

    await refreshModelCatalog({ http, env: {} });

    expect(catalogModelById("gpt-4.1-nano")?.verified).toBe(false);
    expect(catalogModelById("gpt-5.4-mini")?.verified).toBe(false);
    expect(calls.some((c) => c.url === OPENAI_MODELS_URL)).toBe(false);
  });

  it("si la lista del proveedor falla, se conserva la de pi.dev sin filtrar (fail-soft)", async () => {
    const { http } = fakeHttp({
      [piUrl("openai")]: { body: [GPT54_MINI, GPT41_NANO] },
      [OPENAI_MODELS_URL]: { status: 500 },
    });

    await refreshModelCatalog({ http, env: { OPENAI_API_KEY: "sk-test" } });

    expect(catalogModelById("gpt-4.1-nano")?.verified).toBe(false);
  });
});

describe("S3 — NanBuilders aporta todos sus modelos, con ids que enrutan a él", () => {
  const BASE = "https://nb.test/v1";
  const MODELS_URL = `${BASE}/models`;

  it("lista los modelos de NanBuilders con prefijo `nan/` cuando el id no trae uno reconocido", async () => {
    const { http, calls } = fakeHttp({
      [MODELS_URL]: { body: { data: [{ id: "glm5.3-flash" }, { id: "nan/ya-prefijado" }] } },
    });

    await refreshModelCatalog({
      http,
      env: { NANBUILDERS_BASE_URL: BASE, NANBUILDERS_API_KEY: "nb-key" },
    });

    const nb = buildCatalogResponse().providers.find((p) => p.id === "nanbuilders");
    expect(nb?.models.map((m) => m.id)).toEqual(["nan/glm5.3-flash", "nan/ya-prefijado"]);
    // Lo que importa de verdad: cada id vuelve a NanBuilders al llamar al modelo.
    for (const modelo of nb!.models) expect(providerForModel(modelo.id)).toBe("nanbuilders");
    expect(calls.find((c) => c.url === MODELS_URL)?.headers.authorization).toBe("Bearer nb-key");
    expect(routableNanBuildersId("glm5.3-flash")).toBe("nan/glm5.3-flash");
    expect(routableNanBuildersId("nb/otro")).toBe("nb/otro");
  });

  it("sin NANBUILDERS_BASE_URL/clave no aparece y nada se rompe (fail-soft)", async () => {
    const { http, calls } = fakeHttp({ [piUrl("openai")]: { body: [GPT54_MINI] } });

    const resumen = await refreshModelCatalog({ http, env: { NANBUILDERS_BASE_URL: "", NANBUILDERS_API_KEY: "" } });

    expect(buildCatalogResponse().providers.map((p) => p.id)).not.toContain("nanbuilders");
    expect(calls.some((c) => c.url.includes("nb.test"))).toBe(false);
    expect(resumen.failed).not.toContain("nanbuilders");
  });

  it("si NanBuilders está configurado y falla, el proveedor no se inventa (conserva lo último bueno)", async () => {
    const ok = fakeHttp({ [MODELS_URL]: { body: { data: [{ id: "glm5.3-flash" }] } } });
    const env = { NANBUILDERS_BASE_URL: BASE, NANBUILDERS_API_KEY: "nb-key" };
    await refreshModelCatalog({ http: ok.http, env });

    const caida = fakeHttp({ [MODELS_URL]: { status: 503 } });
    await refreshModelCatalog({ http: caida.http, env });

    expect(buildCatalogResponse().providers.find((p) => p.id === "nanbuilders")?.models.map((m) => m.id)).toEqual([
      "nan/glm5.3-flash",
    ]);
  });
});

describe("S6 — el catálogo es la allowlist, y respeta la tabla estática por proveedor", () => {
  it("un id del catálogo vivo se acepta; uno que no está, no", async () => {
    const { http } = fakeHttp({ [piUrl("openai")]: { body: [GPT54_MINI] } });
    await refreshModelCatalog({ http, env: {} });

    expect(isCatalogModel("gpt-5.4-mini")).toBe(true);
    expect(isCatalogModel("gpt-4.1-nano")).toBe(false);
  });

  it("un proveedor que nunca respondió conserva el respaldo estático al elegir modelo", async () => {
    const { http } = fakeHttp({ [piUrl("openai")]: { body: [GPT54_MINI] } });
    await refreshModelCatalog({ http, env: {} });

    // anthropic no tiene catálogo vivo en esta pasada (pi.dev no respondió por él).
    expect(liveCatalogProviders().map((p) => p.id)).not.toContain("anthropic");
    expect(isCatalogModel("claude-opus-5")).toBe(true);
  });
});
