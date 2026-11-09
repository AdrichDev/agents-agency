/**
 * S7 (model-catalog, T3) — el selector del front de AA usa el catálogo de `GET /api/models`.
 * S4 corregido (T6) — DeepSeek no es un proveedor: sus modelos llegan como modelos de nanBuilders.
 *
 * El front NO tiene runner de tests unitarios (`front/package.json`: sólo `typecheck` y
 * `test:e2e` con Playwright), así que esto es una prueba ESTRUCTURAL como
 * `modelos-catalogo.spec.ts`: importa los módulos y comprueba el comportamiento en Node, sin
 * `page.goto` y sin arrancar `next dev` (`E2E_BASE_URL` apunta a algo que escuche; estos casos no
 * usan el navegador).
 *
 * Que esto se pueda probar así no es casualidad: el hook no contiene lógica propia. Pedir el
 * catálogo, validar su forma y caer al respaldo está en `loadModelCatalog` /
 * `providersFromCatalogResponse` (`front/lib/models.ts`), funciones puras de la respuesta HTTP que
 * reciben el cliente por parámetro. `useModelCatalog` sólo las enchufa a React.
 *
 * Lo que se comprueba, y por qué:
 *   1. El respaldo estático sigue sirviendo si el endpoint falla, y NO ofrece DeepSeek como
 *      proveedor propio (S4): ofrecerlo en el respaldo volvería a pintar una fila que el back no
 *      sirve — el fallo que se vio en producción.
 *   2. La respuesta del back se traduce con SUS etiquetas y SUS efforts, incluidos los modelos
 *      DeepSeek tal y como los publica nanBuilders (`nan/deepseek-v4-flash`).
 *   3. Un fallo de red, un 500 o una respuesta con otra forma caen al respaldo, nunca dejan el
 *      selector vacío.
 *   4. Los tres consumidores usan el hook y no la lista estática directamente.
 *   5. El panel BYOK no tiene fila de DeepSeek (como el enum del back, que ya no la acepta).
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LLM_PROVIDERS,
  allowedEffortsFor,
  defaultEffortFor,
  findModel,
  loadModelCatalog,
  modelSupportsEffort,
  providersFromCatalogResponse,
} from "../lib/models";

/** Respuesta de `GET /api/models` tal y como la define S7 del back (recortada a lo que se usa). */
const RESPUESTA_API = {
  providers: [
    {
      id: "openai",
      name: "OpenAI",
      models: [
        {
          id: "gpt-5.4-mini",
          name: "GPT-5.4 mini",
          provider: "openai",
          reasoning: true,
          efforts: ["none", "low", "medium", "high", "xhigh"],
          defaultEffort: "none",
          contextWindow: 400000,
          verified: true,
        },
        {
          id: "gpt-5.4",
          name: "GPT-5.4 (catálogo vivo)",
          provider: "openai",
          reasoning: true,
          efforts: ["none", "low", "medium", "high", "xhigh"],
          defaultEffort: "high",
          contextWindow: 400000,
          verified: true,
        },
      ],
    },
    {
      id: "nanbuilders",
      name: "nanBuilders",
      models: [
        {
          id: "nan/glm5.3-flash",
          name: "glm5.3-flash",
          provider: "nanbuilders",
          reasoning: false,
          efforts: [],
          defaultEffort: null,
          contextWindow: null,
          verified: true,
        },
        {
          // DeepSeek llega así (S4): como modelo de nanBuilders, no como proveedor propio.
          id: "nan/deepseek-v4-flash",
          name: "deepseek-v4-flash",
          provider: "nanbuilders",
          reasoning: true,
          efforts: ["high", "max"],
          defaultEffort: "max",
          contextWindow: 1000000,
          verified: true,
        },
      ],
    },
  ],
};

test.describe("S7/S4 — respaldo estático (cuando /api/models no responde)", () => {
  test("no ofrece DeepSeek como proveedor ni como modelos sueltos", () => {
    expect(LLM_PROVIDERS.map((p) => p.id)).toEqual(["openai", "gemini", "anthropic"]);

    const ids = LLM_PROVIDERS.flatMap((p) => p.models.map((m) => m.id));
    expect(ids.filter((id) => id.toLowerCase().includes("deepseek"))).toEqual([]);
    expect(findModel("deepseek-v4-pro")).toBeUndefined();
    expect(findModel("deepseek-v4-flash")).toBeUndefined();
  });

  test("sigue sin ofrecer gpt-4.1-nano, que OpenAI retiró", () => {
    const ids = LLM_PROVIDERS.flatMap((p) => p.models.map((m) => m.id));

    expect(ids).not.toContain("gpt-4.1-nano");
    expect(findModel("gpt-4.1-nano")).toBeUndefined();
  });
});

test.describe("S7 — traducción de la respuesta de /api/models", () => {
  test("usa las etiquetas y los efforts del back, no la tabla estática", () => {
    const providers = providersFromCatalogResponse(RESPUESTA_API);

    expect(providers.map((p) => p.label)).toEqual(["OpenAI", "nanBuilders"]);
    expect(providers.map((p) => p.id)).not.toContain("deepseek");
    // El nombre y el default los manda el back; el respaldo estático dice otra cosa.
    expect(findModel("gpt-5.4", providers)?.label).toBe("GPT-5.4 (catálogo vivo)");
    expect(defaultEffortFor("gpt-5.4", providers)).toBe("high");
    expect(defaultEffortFor("gpt-5.4")).toBe("none");
  });

  test("un nivel que el back no sabe mandar (`max`) no se ofrece", () => {
    const providers = providersFromCatalogResponse(RESPUESTA_API);

    // `max` no está en el vocabulario del back, así que se descarta y el default cae al primer
    // nivel válido: prometerlo sería ofrecer un effort que nunca se envía.
    expect(allowedEffortsFor("nan/deepseek-v4-flash", providers).map((e) => e.id)).toEqual(["high"]);
    expect(defaultEffortFor("nan/deepseek-v4-flash", providers)).toBe("high");
  });

  test("un modelo sin efforts se pinta como no razonador", () => {
    const providers = providersFromCatalogResponse(RESPUESTA_API);

    expect(modelSupportsEffort("nan/glm5.3-flash", providers)).toBe(false);
    expect(allowedEffortsFor("nan/glm5.3-flash", providers)).toEqual([]);
  });

  test("una respuesta con otra forma devuelve lista vacía, no revienta", () => {
    expect(providersFromCatalogResponse(null)).toEqual([]);
    expect(providersFromCatalogResponse({ error: "boom" })).toEqual([]);
    expect(providersFromCatalogResponse([1, 2, 3])).toEqual([]);
    // Proveedor sin modelos: no se pinta un grupo vacío.
    expect(providersFromCatalogResponse({ providers: [{ id: "openai", name: "OpenAI", models: [] }] })).toEqual([]);
  });
});

test.describe("S7 — carga del catálogo y respaldo", () => {
  test("con el endpoint disponible usa el catálogo de la API (DeepSeek dentro de nanbuilders)", async () => {
    const pedidas: string[] = [];
    const catalog = await loadModelCatalog(async (path) => {
      pedidas.push(path);
      return RESPUESTA_API;
    });

    expect(pedidas).toEqual(["/api/models"]);
    expect(catalog.source).toBe("api");
    const ids = catalog.providers.flatMap((p) => p.models.map((m) => m.id));
    expect(ids).toContain("nan/deepseek-v4-flash");
    expect(ids).toContain("nan/glm5.3-flash");
    expect(ids).not.toContain("deepseek-v4-flash");
    expect(catalog.providers.map((p) => p.id)).not.toContain("deepseek");
  });

  test("si la llamada falla, cae al respaldo estático sin dejar el selector vacío", async () => {
    const catalog = await loadModelCatalog(async () => {
      throw new Error("500 Internal Server Error");
    });

    expect(catalog.source).toBe("static");
    expect(catalog.providers).toBe(LLM_PROVIDERS);
    const ids = catalog.providers.flatMap((p) => p.models.map((m) => m.id));
    expect(ids).not.toContain("deepseek-v4-pro");
    expect(ids).not.toContain("gpt-4.1-nano");
    expect(ids).toContain("gpt-5.4-mini");
  });

  test("una respuesta válida pero vacía también cae al respaldo (mejor vieja que ninguna)", async () => {
    const catalog = await loadModelCatalog(async () => ({ providers: [] }));

    expect(catalog.source).toBe("static");
    expect(catalog.providers).toBe(LLM_PROVIDERS);
  });
});

test.describe("S7 — los consumidores usan el hook, no la lista estática", () => {
  const consumidores = [
    "../components/ModelEffortSelect.tsx",
    "../components/AgentModelPanel.tsx",
    "../components/agent-wizard/PromptStep.tsx",
  ];

  for (const file of consumidores) {
    test(`${file} lee el catálogo con useModelCatalog`, () => {
      const src = readFileSync(resolve(__dirname, file), "utf8");

      expect(src).toContain("useModelCatalog");
      // Pintar LLM_PROVIDERS directamente es exactamente lo que este cambio quita: el selector
      // volvería a mostrar la lista a mano aunque la API respondiera.
      expect(src).not.toMatch(/LLM_PROVIDERS\s*\.map/);
      expect(src).toMatch(/providers\.map/);
    });
  }

  test("el hook pide /api/models con el cliente del panel y nunca lanza", () => {
    const src = readFileSync(resolve(__dirname, "../lib/use-model-catalog.ts"), "utf8");

    expect(src).toContain("loadModelCatalog");
    expect(src).toContain("api(");
    expect(src).toContain('"use client"');
  });
});

test.describe("S4 — el panel BYOK no ofrece ya la fila de DeepSeek", () => {
  test("no hay fila DeepSeek y las filas son los cuatro proveedores servidos", () => {
    const src = readFileSync(resolve(__dirname, "../components/clientes/LlmCredentialsPanel.tsx"), "utf8");

    // La regla es sobre las FILAS (el comentario del fichero explica el motivo y puede nombrarlo).
    expect(src).not.toMatch(/id:\s*"deepseek"/);
    const ids = [...src.matchAll(/\{\s*id:\s*"([a-z][a-z0-9]*)",\s*label:/g)].map((m) => m[1]);
    expect(ids).toEqual(["openai", "gemini", "anthropic", "nanbuilders"]);
  });
});
