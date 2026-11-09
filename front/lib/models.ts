// Catálogo de LLMs para el UI (agente, config global, estudios de mercado) con las
// capacidades de reasoning_effort POR MODELO.
//
// model-catalog (S7): este fichero ya NO es la fuente del catálogo. La fuente es `GET /api/models`
// del back de AA (que lo lee de pi.dev y lo cruza con lo que cada proveedor sirve de verdad), y
// `LLM_PROVIDERS` queda sólo como RESPALDO si esa llamada falla. Se mantiene aquí, a mano, por dos
// motivos: el panel tiene que poder pintar el selector en el primer render (sin esperar a la red)
// y, sin back disponible, es preferible ofrecer una lista buena y algo vieja a no ofrecer ninguna.
// Lo que llega de la API se traduce con `providersFromCatalogResponse` y se pide con
// `loadModelCatalog`; el hook que lo enchufa a React vive en `use-model-catalog.ts`.
//
// Capacidades por modelo (sólo aplica al respaldo; la API manda sobre esto):
//  - OpenAI gpt-5*: none/low/medium/high/xhigh (chat.completions NO acepta 'max').
//  - OpenAI gpt-4*: sin reasoning_effort. `gpt-4.1-nano` está RETIRADO por OpenAI (404): fuera del
//    catálogo, igual que en el back. Ver la migración 20261110090000_retire_gpt_4_1_nano.
//  - Gemini 3.x: minimal/low/medium/high (thinking_level).
//  - Anthropic claude*: SIN effort, a propósito. Su capa OpenAI-compatible IGNORA EN SILENCIO
//    los campos que no entiende, así que un effort mal enviado no daría error: daría otra
//    respuesta. Ver la cabecera de back/src/lib/model-capabilities.ts.
//  - DeepSeek NO está aquí (S4 corregido): no es un proveedor propio, sus modelos llegan del
//    catálogo como modelos de nanBuilders (`nan/deepseek-…`). Ofrecerlos sueltos en el respaldo
//    volvería a pintar la fila que el back ya no sirve.

export interface LlmModel {
  id: string;
  label: string;
  /** Niveles de reasoning_effort admitidos ([] = no razonador). */
  efforts: string[];
  /** Nivel por defecto que se manda; null si no soporta effort. */
  defaultEffort: string | null;
}

export interface LlmProvider {
  id: string;
  label: string;
  models: LlmModel[];
}

/** Respuesta de `GET /api/models` (S7 del back). Sólo se describen los campos que se usan. */
export interface CatalogModelDto {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  efforts: string[];
  defaultEffort: string | null;
  contextWindow: number | null;
  verified: boolean;
}

export interface CatalogProviderDto {
  id: string;
  name: string;
  models: CatalogModelDto[];
}

export interface CatalogResponseDto {
  providers: CatalogProviderDto[];
}

/** De dónde salió la lista que está viendo el selector. Útil para avisar sin mentir. */
export type CatalogSource = "api" | "static";

export interface ModelCatalog {
  providers: LlmProvider[];
  source: CatalogSource;
}

const E_GPT5 = ["none", "low", "medium", "high", "xhigh"];
const E_GEMINI = ["minimal", "low", "medium", "high"];

/**
 * RESPALDO estático. Mismo contenido que `back/src/lib/model-capabilities.ts` (que a su vez es ya
 * sólo respaldo del catálogo vivo) y en el mismo orden de proveedores que devuelve la API.
 */
export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: "openai",
    label: "OpenAI",
    models: [
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", efforts: E_GPT5, defaultEffort: "low" },
      { id: "gpt-5.5", label: "GPT-5.5", efforts: E_GPT5, defaultEffort: "medium" },
      { id: "gpt-5.4", label: "GPT-5.4", efforts: E_GPT5, defaultEffort: "none" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini", efforts: E_GPT5, defaultEffort: "none" },
      { id: "gpt-5.4-nano", label: "GPT-5.4 nano", efforts: E_GPT5, defaultEffort: "none" },
      { id: "gpt-4.1", label: "GPT-4.1 (sin razonamiento)", efforts: [], defaultEffort: null },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini (sin razonamiento)", efforts: [], defaultEffort: null },
      { id: "gpt-4o", label: "GPT-4o (sin razonamiento)", efforts: [], defaultEffort: null },
      { id: "gpt-4o-mini", label: "GPT-4o mini (sin razonamiento)", efforts: [], defaultEffort: null },
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    models: [
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", efforts: ["low", "medium", "high"], defaultEffort: "high" },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", efforts: E_GEMINI, defaultEffort: "medium" },
      { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", efforts: E_GEMINI, defaultEffort: "medium" },
      { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", efforts: E_GEMINI, defaultEffort: "minimal" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    models: [
      { id: "claude-opus-5", label: "Claude Opus 5", efforts: [], defaultEffort: null },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", efforts: [], defaultEffort: null },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", efforts: [], defaultEffort: null },
    ],
  },
];

export const EFFORT_LABELS: Record<string, string> = {
  none: "Ninguno (más barato)",
  minimal: "Mínimo",
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  xhigh: "Extra alto (más caro)",
};

/** Registro JSON por si llega algo con otra forma (un error, un HTML): nunca debe reventar. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Niveles que este UI sabe pintar, en orden canónico. Un nivel desconocido se descarta en vez de
 * ofrecerse: la lista de efforts la manda el back, y prometer un nivel que ni él sabe mandar es el
 * mismo error que la tabla estática existía para evitar. Un `max` de pi.dev cae aquí a propósito.
 */
const KNOWN_EFFORTS = Object.keys(EFFORT_LABELS);

/**
 * Traduce la respuesta de `GET /api/models` a la forma que consumen los selectores.
 *
 * Descarta lo que no se pueda pintar (proveedor o modelo sin id) y devuelve `[]` si la respuesta
 * no tiene la forma esperada: una lista vacía es la señal de "usa el respaldo", nunca un selector
 * en blanco.
 */
export function providersFromCatalogResponse(payload: unknown): LlmProvider[] {
  const root = asRecord(payload);
  const rawProviders = Array.isArray(root?.providers) ? (root!.providers as unknown[]) : [];

  const providers: LlmProvider[] = [];
  for (const rawProvider of rawProviders) {
    const provider = asRecord(rawProvider);
    if (!provider) continue;
    const providerId = typeof provider.id === "string" ? provider.id.trim() : "";
    if (!providerId) continue;

    const rawModels = Array.isArray(provider.models) ? (provider.models as unknown[]) : [];
    const models: LlmModel[] = [];
    for (const rawModel of rawModels) {
      const model = asRecord(rawModel);
      if (!model) continue;
      const id = typeof model.id === "string" ? model.id.trim() : "";
      if (!id) continue;

      const efforts = (Array.isArray(model.efforts) ? model.efforts : [])
        .filter((e): e is string => typeof e === "string" && KNOWN_EFFORTS.includes(e));
      const namedDefault =
        typeof model.defaultEffort === "string" && efforts.includes(model.defaultEffort)
          ? model.defaultEffort
          : null;

      models.push({
        id,
        label: typeof model.name === "string" && model.name.trim() ? model.name : id,
        efforts,
        // Mismo criterio que el back: si el default no es válido para ese modelo, el primero.
        defaultEffort: namedDefault ?? efforts[0] ?? null,
      });
    }

    if (models.length === 0) continue;
    providers.push({
      id: providerId,
      label: typeof provider.name === "string" && provider.name.trim() ? provider.name : providerId,
      models,
    });
  }

  return providers;
}

/**
 * Pide el catálogo al back y cae al respaldo estático si algo falla (S7: "la lista estática queda
 * sólo como respaldo si el endpoint falla").
 *
 * `request` se recibe por parámetro en vez de importar `lib/api` aquí: así este módulo sigue siendo
 * una hoja sin dependencias —lo importan pruebas estructurales y el propio back comparte el
 * criterio— y el hook `useModelCatalog` es el único que conoce el cliente HTTP del panel.
 */
export async function loadModelCatalog(
  request: (path: string) => Promise<unknown>,
  fallback: LlmProvider[] = LLM_PROVIDERS
): Promise<ModelCatalog> {
  try {
    const providers = providersFromCatalogResponse(await request("/api/models"));
    return providers.length > 0
      ? { providers, source: "api" }
      : { providers: fallback, source: "static" };
  } catch {
    return { providers: fallback, source: "static" };
  }
}

/** Busca el modelo por id en todo el catálogo (el de la API si se pasa, el respaldo si no). */
export function findModel(model: string, providers: LlmProvider[] = LLM_PROVIDERS): LlmModel | undefined {
  for (const p of providers) {
    const m = p.models.find((x) => x.id === model);
    if (m) return m;
  }
  return undefined;
}

/** Deriva el proveedor a partir del id del modelo. */
export function providerOfModel(model: string, providers: LlmProvider[] = LLM_PROVIDERS): LlmProvider {
  return providers.find((p) => p.models.some((m) => m.id === model)) ?? providers[0];
}

/** Niveles de effort admitidos por el modelo (con etiqueta), o [] si no razona. */
export function allowedEffortsFor(
  model: string,
  providers: LlmProvider[] = LLM_PROVIDERS
): { id: string; label: string }[] {
  return (findModel(model, providers)?.efforts ?? []).map((id) => ({
    id,
    label: EFFORT_LABELS[id] ?? id,
  }));
}

/** Nivel de effort por defecto del modelo (null si no soporta). */
export function defaultEffortFor(
  model: string,
  providers: LlmProvider[] = LLM_PROVIDERS
): string | null {
  return findModel(model, providers)?.defaultEffort ?? null;
}

/** ¿Este modelo acepta reasoning_effort? */
export function modelSupportsEffort(
  model: string,
  providers: LlmProvider[] = LLM_PROVIDERS
): boolean {
  return (findModel(model, providers)?.efforts.length ?? 0) > 0;
}
