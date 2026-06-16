// Catálogo de LLMs disponibles para selección en UI (agente y config global).
// El effort solo aplica a modelos razonadores (OpenAI gpt-5*). Para Gemini se ignora.

export interface LlmProvider {
  id: string;
  label: string;
  models: { id: string; label: string }[];
  /** true si sus modelos aceptan reasoning_effort */
  supportsEffort: boolean;
}

export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: "openai",
    label: "OpenAI",
    supportsEffort: true,
    models: [
      { id: "gpt-5.4", label: "GPT-5.4 (fuerte)" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini (rápido)" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini (económico)" },
      { id: "gpt-4.1-nano", label: "GPT-4.1 nano (ultra barato)" },
      { id: "gpt-4o-mini", label: "GPT-4o mini (barato)" },
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    supportsEffort: false,
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
  },
];

// Valores soportados por gpt-5.4 (confirmados por la propia API):
// none | low | medium | high | xhigh. 'minimal' fue retirado.
export const REASONING_EFFORTS = [
  { id: "none", label: "Ninguno (más barato)" },
  { id: "low", label: "Bajo" },
  { id: "medium", label: "Medio" },
  { id: "high", label: "Alto" },
  { id: "xhigh", label: "Extra alto (más caro)" },
];

/** Deriva el proveedor a partir del id del modelo. */
export function providerOfModel(model: string): LlmProvider {
  return (
    LLM_PROVIDERS.find((p) => p.models.some((m) => m.id === model)) ??
    LLM_PROVIDERS[0]
  );
}

/** ¿Este modelo acepta reasoning_effort? (gpt-5*) */
export function modelSupportsEffort(model: string): boolean {
  return model.startsWith("gpt-5");
}
