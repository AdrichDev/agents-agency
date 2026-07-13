// Catálogo de LLMs para el UI (agente, config global, estudios de mercado) con las
// capacidades de reasoning_effort POR MODELO. Verificado contra las APIs reales y la doc
// oficial. MANTENER EN SINCRONÍA con back/src/lib/model-capabilities.ts.
//
//  - OpenAI gpt-5*: none/low/medium/high/xhigh (chat.completions NO acepta 'max').
//  - OpenAI gpt-4*: sin reasoning_effort.
//  - Gemini 3.x: minimal/low/medium/high (thinking_level).

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

const E_GPT5 = ["none", "low", "medium", "high", "xhigh"];
const E_GEMINI = ["minimal", "low", "medium", "high"];

export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: "openai",
    label: "OpenAI",
    models: [
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", efforts: E_GPT5, defaultEffort: "medium" },
      { id: "gpt-5.5", label: "GPT-5.5", efforts: E_GPT5, defaultEffort: "medium" },
      { id: "gpt-5.4", label: "GPT-5.4", efforts: E_GPT5, defaultEffort: "none" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini", efforts: E_GPT5, defaultEffort: "none" },
      { id: "gpt-5.4-nano", label: "GPT-5.4 nano", efforts: E_GPT5, defaultEffort: "none" },
      { id: "gpt-4.1", label: "GPT-4.1 (sin razonamiento)", efforts: [], defaultEffort: null },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini (sin razonamiento)", efforts: [], defaultEffort: null },
      { id: "gpt-4.1-nano", label: "GPT-4.1 nano (sin razonamiento)", efforts: [], defaultEffort: null },
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
];

export const EFFORT_LABELS: Record<string, string> = {
  none: "Ninguno (más barato)",
  minimal: "Mínimo",
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  xhigh: "Extra alto (más caro)",
};

/** Busca el modelo por id en todo el catálogo. */
export function findModel(model: string): LlmModel | undefined {
  for (const p of LLM_PROVIDERS) {
    const m = p.models.find((x) => x.id === model);
    if (m) return m;
  }
  return undefined;
}

/** Deriva el proveedor a partir del id del modelo. */
export function providerOfModel(model: string): LlmProvider {
  return LLM_PROVIDERS.find((p) => p.models.some((m) => m.id === model)) ?? LLM_PROVIDERS[0];
}

/** Niveles de effort admitidos por el modelo (con etiqueta), o [] si no razona. */
export function allowedEffortsFor(model: string): { id: string; label: string }[] {
  return (findModel(model)?.efforts ?? []).map((id) => ({ id, label: EFFORT_LABELS[id] ?? id }));
}

/** Nivel de effort por defecto del modelo (null si no soporta). */
export function defaultEffortFor(model: string): string | null {
  return findModel(model)?.defaultEffort ?? null;
}

/** ¿Este modelo acepta reasoning_effort? */
export function modelSupportsEffort(model: string): boolean {
  return (findModel(model)?.efforts.length ?? 0) > 0;
}
