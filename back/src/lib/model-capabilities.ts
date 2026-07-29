// Tabla de capacidades de reasoning_effort por modelo. Fuente única del back para saber
// qué niveles de effort acepta cada modelo (y cuál mandar por defecto). Verificada contra
// las APIs reales (probe) y la doc oficial (OpenAI chat.completions + Gemini OpenAI-compat).
//
// Reglas confirmadas:
//  - OpenAI gpt-5*: none/low/medium/high/xhigh (chat.completions NO acepta 'max' → solo Responses API).
//  - OpenAI gpt-4*: no aceptan reasoning_effort (400 "Unrecognized argument").
//  - Gemini 3.x: reasoning_effort → thinking_level = minimal/low/medium/high (sin none/xhigh).
//  - Gemini 2.5: usa thinking_budget (tokens), no niveles → fuera del selector.
//  - Anthropic claude* (H2 aa-credenciales-byok-multiproveedor): SIN effort, a propósito.
//    Su capa OpenAI-compatible IGNORA EN SILENCIO los campos que no entiende (doc oficial),
//    así que un reasoning_effort mal enviado no daría 400: daría otra respuesta, plausible y
//    distinta de la pedida. Con OpenAI y Gemini el error se ve en el primer intento; aquí no
//    se vería nunca. El pensamiento extendido de Claude va por `extra_body.thinking`
//    (budget_tokens), que es una función nueva con un modo de fallo invisible y se deja fuera.
//
// MANTENER EN SINCRONÍA con front/lib/models.ts.

export type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ModelCap {
  efforts: Effort[];
  defaultEffort: Effort | null;
}

const E_GPT5: Effort[] = ["none", "low", "medium", "high", "xhigh"];
const E_GEMINI: Effort[] = ["minimal", "low", "medium", "high"];

export const MODEL_CAPABILITIES: Record<string, ModelCap> = {
  // OpenAI — razonadores. (gpt-5.6-sol retirado: acceso inconsistente en la cuenta — 401/400.)
  "gpt-5.6-luna": { efforts: E_GPT5, defaultEffort: "medium" },
  "gpt-5.5": { efforts: E_GPT5, defaultEffort: "medium" },
  "gpt-5.4": { efforts: E_GPT5, defaultEffort: "none" },
  "gpt-5.4-mini": { efforts: E_GPT5, defaultEffort: "none" },
  "gpt-5.4-nano": { efforts: E_GPT5, defaultEffort: "none" },
  // OpenAI — no razonadores (sin effort)
  "gpt-4.1": { efforts: [], defaultEffort: null },
  "gpt-4.1-mini": { efforts: [], defaultEffort: null },
  "gpt-4.1-nano": { efforts: [], defaultEffort: null },
  "gpt-4o": { efforts: [], defaultEffort: null },
  "gpt-4o-mini": { efforts: [], defaultEffort: null },
  // Gemini 3.x (OpenAI-compat)
  "gemini-3.1-pro-preview": { efforts: ["low", "medium", "high"], defaultEffort: "high" },
  "gemini-3.5-flash": { efforts: E_GEMINI, defaultEffort: "medium" },
  "gemini-3-flash-preview": { efforts: E_GEMINI, defaultEffort: "medium" },
  "gemini-3.1-flash-lite": { efforts: E_GEMINI, defaultEffort: "minimal" },
  // Anthropic (OpenAI-compat, https://api.anthropic.com/v1/). SIN effort a propósito: ver la
  // cabecera. `modelSupportsEffort` devuelve false para estos, así que la gobernanza BORRA
  // `reasoning_effort` y CONSERVA `temperature` — que Claude sí admite.
  "claude-opus-5": { efforts: [], defaultEffort: null },
  "claude-sonnet-5": { efforts: [], defaultEffort: null },
  "claude-haiku-4-5-20251001": { efforts: [], defaultEffort: null },
};

/**
 * Precio del token cacheado como fracción del token de entrada normal, por modelo.
 * Verificado contra la doc oficial de precios de OpenAI el 29/07/2026.
 *
 * Sirve para imputar al cupo del cliente lo que su conversación cuesta DE VERDAD: el proveedor
 * sirve el prefijo repetido de su caché entre 2x y 10x más barato, y cobrarlo a precio completo
 * es un error sistemático a favor de quien cobra.
 *
 * Un ratio fijo sería incorrecto para cuatro de los cinco modelos en producción: gpt-5.4-* descuenta
 * el 90% y gpt-4o el 50%. Por eso la tabla es por modelo y no una constante.
 *
 * AUSENCIA = NO PONDERAR. Un modelo que no esté aquí imputa el bruto, que es el comportamiento
 * previo a este cambio. Gemini y Anthropic están fuera a propósito: sus ratios no se han verificado
 * contra doc oficial, y un ratio inventado aflojaría el cupo con un número indefendible.
 */
export const CACHED_TOKEN_RATIO: Record<string, number> = {
  // OpenAI razonadores — $0.075 cacheado sobre $0.75 de entrada (gpt-5.4-mini).
  "gpt-5.6-luna": 0.1,
  "gpt-5.5": 0.1,
  "gpt-5.4": 0.1,
  "gpt-5.4-mini": 0.1,
  "gpt-5.4-nano": 0.1,
  // OpenAI 4.1 — $0.10 cacheado sobre $0.40 de entrada (gpt-4.1-mini).
  "gpt-4.1": 0.25,
  "gpt-4.1-mini": 0.25,
  "gpt-4.1-nano": 0.25,
  // OpenAI 4o — $1.25 cacheado sobre $2.50 de entrada.
  "gpt-4o": 0.5,
  "gpt-4o-mini": 0.5,
};

/** Capacidades del modelo (o vacío si desconocido → nunca se manda effort). */
export function capsFor(model?: string): ModelCap {
  return (model && MODEL_CAPABILITIES[model]) || { efforts: [], defaultEffort: null };
}

/** ¿El modelo acepta reasoning_effort? */
export function modelSupportsEffort(model?: string): boolean {
  return capsFor(model).efforts.length > 0;
}

/**
 * Devuelve un nivel de effort VÁLIDO para el modelo, o null si el modelo no soporta
 * effort. Si el nivel pedido no es válido para ese modelo, cae a su default.
 */
export function resolveEffort(model: string | undefined, requested?: string | null): string | null {
  const caps = capsFor(model);
  if (caps.efforts.length === 0) return null;
  if (requested && caps.efforts.includes(requested as Effort)) return requested;
  return caps.defaultEffort;
}

/** Ids de todos los modelos del catálogo (para allowlists). */
export const KNOWN_MODEL_IDS = Object.keys(MODEL_CAPABILITIES);
