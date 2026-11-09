/**
 * S1 + S6 (model-catalog, T1) — qué se guarda de cada modelo que sirve pi.dev.
 *
 * El catálogo del back deja de ser una tabla escrita a mano y pasa a leerse de
 * `GET https://pi.dev/api/models/providers/<id>?types=chat`. Aquí se prueba la parte que NO
 * toca la red: la forma de la respuesta (pi.dev puede devolver un array, `{models:[…]}` o un
 * objeto indexado por id) y la traducción de cada campo al modelo que consume el resto del
 * sistema. Sin precios (S1: "No necesito los precios") y sin modelos que no sean de chat (S2).
 *
 * Los efforts salen de `thinkingLevelMap` (S6), no de una tabla a mano: el mapa que publica
 * pi.dev es el que dice qué niveles acepta cada razonador.
 */
import { describe, it, expect } from "vitest";
import { effortsFromThinkingLevelMap, parsePiDevModels } from "@/lib/llm/catalog";

/** Respuesta real de pi.dev para gpt-5.6-luna (28/08/2026), recortada a lo que se usa. */
const LUNA = {
  id: "gpt-5.6-luna",
  name: "GPT-5.6 Luna",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
  contextWindow: 400000,
  maxTokens: 128000,
  compat: {},
  inputLimits: {},
  type: "chat",
  thinkingLevelMap: {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
};

/** Un modelo no razonador: sin `thinkingLevelMap`, sin efforts. */
const GPT41 = {
  id: "gpt-4.1",
  name: "GPT-4.1",
  api: "openai-completions",
  provider: "openai",
  reasoning: false,
  cost: { input: 2, output: 8 },
  contextWindow: 1047576,
  maxTokens: 32768,
  type: "chat",
};

describe("parsePiDevModels — las tres formas que puede devolver pi.dev", () => {
  it("acepta un array de modelos", () => {
    expect(parsePiDevModels([LUNA]).map((m) => m.id)).toEqual(["gpt-5.6-luna"]);
  });

  it("acepta `{ models: [...] }`", () => {
    expect(parsePiDevModels({ models: [LUNA, GPT41] }).map((m) => m.id)).toEqual([
      "gpt-5.6-luna",
      "gpt-4.1",
    ]);
  });

  it("acepta un objeto de objetos indexado por id (el id de la clave es el respaldo)", () => {
    const parsed = parsePiDevModels({
      "gpt-5.6-luna": LUNA,
      "gpt-4.1": { ...GPT41, id: undefined },
    });

    expect(parsed.map((m) => m.id)).toEqual(["gpt-5.6-luna", "gpt-4.1"]);
  });

  it("una respuesta con otra forma no revienta: devuelve una lista vacía", () => {
    expect(parsePiDevModels(null)).toEqual([]);
    expect(parsePiDevModels("vaya")).toEqual([]);
    expect(parsePiDevModels({ error: "boom" })).toEqual([]);
  });
});

describe("parsePiDevModels — qué se guarda de cada modelo", () => {
  it("conserva id, nombre, reasoning, efforts, defaultEffort y contextWindow", () => {
    expect(parsePiDevModels([LUNA])[0]).toEqual({
      id: "gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      reasoning: true,
      efforts: ["none", "low", "medium", "high", "xhigh"],
      // S6: effort por defecto `low` en razonadores.
      defaultEffort: "low",
      contextWindow: 400000,
    });
  });

  it("no guarda el precio: `cost` se cae en el parseo, no se filtra al responder", () => {
    const [luna] = parsePiDevModels([LUNA]);

    expect(luna).not.toHaveProperty("cost");
    expect(JSON.stringify(parsePiDevModels([LUNA, GPT41]))).not.toMatch(/cost/i);
  });

  it("solo conserva modelos `type: \"chat\"`", () => {
    const payload = [
      LUNA,
      { id: "text-embedding-3-large", name: "Embedding", type: "embedding" },
      { id: "gpt-image-1", name: "Image", type: "image" },
      GPT41,
    ];

    expect(parsePiDevModels(payload).map((m) => m.id)).toEqual(["gpt-5.6-luna", "gpt-4.1"]);
  });

  it("un modelo no razonador no ofrece effort ni default", () => {
    const [, gpt41] = parsePiDevModels([LUNA, GPT41]);

    expect(gpt41.reasoning).toBe(false);
    expect(gpt41.efforts).toEqual([]);
    expect(gpt41.defaultEffort).toBeNull();
    expect(gpt41.contextWindow).toBe(1047576);
  });

  it("descarta entradas sin id utilizable (una entrada rota no envenena el catálogo)", () => {
    const parsed = parsePiDevModels([{ name: "sin id" }, null, LUNA]);

    expect(parsed.map((m) => m.id)).toEqual(["gpt-5.6-luna"]);
  });

  it("sin nombre en pi.dev, el nombre es el id (nunca `undefined` en el selector)", () => {
    expect(parsePiDevModels([{ id: "modelo-raro", type: "chat" }])[0].name).toBe("modelo-raro");
  });
});

describe("effortsFromThinkingLevelMap — los niveles salen del mapa de pi.dev", () => {
  it("toma los valores no nulos, mapea `off` a `none` y los ordena canónicamente", () => {
    expect(
      effortsFromThinkingLevelMap({
        high: "high",
        off: "none",
        minimal: null,
        medium: "medium",
        low: "low",
      })
    ).toEqual(["none", "low", "medium", "high"]);
  });

  it("`max` no se ofrece: el back todavía no puede enviarlo (pasaría por chat.completions)", () => {
    // El mapa de luna declara `max: "max"`; hasta que T2 lo sirva por la Responses API, ofrecerlo
    // en el selector sería prometer un effort que el chat.completions rechaza con 400.
    expect(effortsFromThinkingLevelMap({ off: "none", low: "low", max: "max" })).toEqual([
      "none",
      "low",
    ]);
  });

  it("valores desconocidos o no-strings se ignoran", () => {
    expect(effortsFromThinkingLevelMap({ low: "low", raro: "ultra", nulo: null, num: 3 })).toEqual([
      "low",
    ]);
  });

  it("sin mapa (o con basura) no hay esfuerzos", () => {
    expect(effortsFromThinkingLevelMap(undefined)).toEqual([]);
    expect(effortsFromThinkingLevelMap(null)).toEqual([]);
    expect(effortsFromThinkingLevelMap("off")).toEqual([]);
  });
});

// Real run 2026-11-09: Gemini's OpenAI-compatible /models returns ids as "models/<id>", so the
// liveness filter dropped every Gemini model and the provider showed up empty.
import { extractModelIds as extractIdsForGemini } from "@/lib/llm/catalog-sources";
describe("extractModelIds — Gemini model ids", () => {
  it("strips the models/ prefix Gemini puts on its ids", () => {
    expect(
      extractIdsForGemini({ data: [{ id: "models/gemini-3.5-flash" }, { id: "gpt-5.4-mini" }] }),
    ).toEqual(["gemini-3.5-flash", "gpt-5.4-mini"]);
  });
});
