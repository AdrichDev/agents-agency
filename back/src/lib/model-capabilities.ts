// Tabla de capacidades de reasoning_effort por modelo. Fuente única del back para saber
// qué niveles de effort acepta cada modelo (y cuál mandar por defecto). Verificada contra
// las APIs reales (probe) y la doc oficial (OpenAI chat.completions + Gemini OpenAI-compat).
//
// Reglas confirmadas:
//  - OpenAI gpt-5*: none/low/medium/high/xhigh. `max` NO: pi.dev lo declara para gpt-5.6-luna, pero
//    no está en el tipo `ReasoningEffort` del SDK (`low|medium|high`, shared.d.ts) ni lo acepta
//    `chat.completions`, y tampoco se ha verificado contra `/v1/responses` — ofrecerlo sería
//    prometer un nivel que ningún camino del back puede mandar (`llm/catalog.ts`).
//  - OpenAI gpt-5.6-luna: TAMPOCO acepta function tools en chat.completions, con ningún effort
//    ("Function tools with reasoning_effort are not supported for gpt-5.6-luna in
//    /v1/chat/completions. To use function tools, use /v1/responses"). Es el modelo que motivó
//    la ruta Responses (`agent/responses-loop.ts`).
//  - OpenAI gpt-4*: no aceptan reasoning_effort (400 "Unrecognized argument").
//  - OpenAI gpt-4.1-nano: RETIRADO por OpenAI (404 "The model gpt-4.1-nano has been deprecated",
//    incidente responses-api-migration). Fuera del catálogo: seguir ofreciéndolo es ofrecer un
//    agente que no responde. Ver la migración 20261110090000_retire_gpt_4_1_nano.
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
//
// model-catalog (S1/S6): esta tabla ya NO es la única fuente. `capsFor` consulta primero el
// catálogo vivo (`lib/llm/catalog.ts`, descargado de pi.dev) y sólo cae aquí cuando el modelo no
// está en él —arranque, pi.dev caído, o un modelo que el catálogo no conoce. La tabla sigue siendo
// imprescindible por dos motivos que el catálogo no cubre: los efforts cuando no hay catálogo y
// las decisiones de producto que no se deducen de pi.dev (Anthropic sin effort, ver arriba).
//
// QUÉ ENDPOINT sirve un modelo ya NO se decide aquí (S5 de model-catalog): lo decide el PROVEEDOR
// (`providerForModel` → `usesResponsesApi`, ambos en `llm/governance.ts`). Había un `api: "responses"`
// por modelo y se retiró: con "Todos por Responses API" para OpenAI, una marca por modelo sobraba
// y además era falsa en cuanto un modelo `gpt*` nuevo entraba sin ella.

import { catalogModelById } from "@/lib/llm/catalog";

export type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ModelCap {
  efforts: Effort[];
  defaultEffort: Effort | null;
}

const E_GPT5: Effort[] = ["none", "low", "medium", "high", "xhigh"];
const E_GEMINI: Effort[] = ["minimal", "low", "medium", "high"];

export const MODEL_CAPABILITIES: Record<string, ModelCap> = {
  // OpenAI — razonadores. (gpt-5.6-sol retirado: acceso inconsistente en la cuenta — 401/400.)
  // gpt-5.6-luna: `low` por defecto (S3 de responses-api-migration). Medido con herramientas por
  // Responses: ~2 s y responde bien; `none` tardó ~4,6 s sin ganar nada.
  "gpt-5.6-luna": { efforts: E_GPT5, defaultEffort: "low" },
  "gpt-5.5": { efforts: E_GPT5, defaultEffort: "medium" },
  "gpt-5.4": { efforts: E_GPT5, defaultEffort: "none" },
  "gpt-5.4-mini": { efforts: E_GPT5, defaultEffort: "none" },
  "gpt-5.4-nano": { efforts: E_GPT5, defaultEffort: "none" },
  // OpenAI — no razonadores (sin effort)
  "gpt-4.1": { efforts: [], defaultEffort: null },
  "gpt-4.1-mini": { efforts: [], defaultEffort: null },
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
  // OpenAI 4o — $1.25 cacheado sobre $2.50 de entrada.
  "gpt-4o": 0.5,
  "gpt-4o-mini": 0.5,
};

/**
 * Capacidades del modelo: PRIMERO el catálogo vivo (los efforts salen de `thinkingLevelMap` de
 * pi.dev, S6) y, si el modelo no está en él, la tabla estática de arriba.
 *
 * El respaldo no es cortesía: el catálogo se descarga al arrancar y puede no estar todavía (o no
 * estar nunca, con pi.dev caído). Un `capsFor` que sólo mirara el catálogo dejaría de mandar
 * `reasoning_effort` —y de quitar `temperature`— en los razonadores durante esa ventana, que es
 * exactamente el 400 que la tabla existe para evitar.
 */
export function capsFor(model?: string): ModelCap {
  const estatica = model ? MODEL_CAPABILITIES[model] : undefined;
  const viva = model ? catalogModelById(model) : undefined;

  if (viva) {
    // Anthropic se queda SIN effort aunque pi.dev le declare niveles, y no es un olvido: pi.dev
    // describe los modelos de Claude por su API NATIVA (`api: "anthropic-messages"`), donde el
    // nivel de pensamiento es `thinking.budget_tokens`. Nosotros los llamamos por su capa
    // OpenAI-compatible, que IGNORA en silencio `reasoning_effort` — y `modelSupportsEffort`
    // también BORRA `temperature`, que Claude sí respeta. Aplicar aquí el mapa de pi.dev cambiaría
    // en silencio los parámetros de cada llamada a Claude, que es justo el modo de fallo invisible
    // que la cabecera de esta tabla documenta y evita.
    const efforts = viva.provider === "anthropic" ? (estatica?.efforts ?? []) : viva.efforts;
    const defaultEffort =
      efforts.length === 0
        ? null
        : viva.defaultEffort && efforts.includes(viva.defaultEffort)
          ? viva.defaultEffort
          : efforts[0];

    return { efforts: [...efforts], defaultEffort };
  }

  return estatica ?? { efforts: [], defaultEffort: null };
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

/**
 * Ids de la tabla ESTÁTICA.
 *
 * Ya no es la allowlist: desde model-catalog (S6) la decisión de qué modelo se puede elegir la
 * toma `isCatalogModel` (`lib/llm/catalog-sources.ts`) contra el catálogo vivo, con esta tabla como
 * respaldo. Se mantiene exportada porque es la lista estática en sí — lo que hay cuando pi.dev no
 * ha respondido nunca — y hay pruebas que la leen como tal.
 */
export const KNOWN_MODEL_IDS = Object.keys(MODEL_CAPABILITIES);
