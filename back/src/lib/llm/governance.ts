import OpenAI from "openai";
import { resolveEffort, modelSupportsEffort } from "@/lib/model-capabilities";

/**
 * Gobernanza de `chat.completions` compartida por TODOS los clientes LLM
 * (H2 aa-credenciales-byok-multiproveedor, T2.1-T2.3).
 *
 * Por qué existe este fichero y no vive en `lib/openai.ts`, que es donde estaba:
 *
 * La regla de `reasoning_effort` / `temperature` estaba parcheada sobre el SINGLETON global
 * (`openai.ts`, `openai.chat.completions.create = ...`), es decir, atada a un cliente concreto
 * construido con `process.env`. El modo BYOK necesita exactamente la misma regla sobre clientes
 * construidos con la clave de cada tenant. Duplicarla sería garantizar que un día divergen, y el
 * síntoma de esa divergencia no sería un test rojo: sería un 400 del proveedor SÓLO para los
 * clientes en BYOK — o sea, sólo para los que pagan por traer su clave. Un fallo que se
 * manifiesta únicamente en el camino menos recorrido es el peor de los dos.
 *
 * Aquí no se importa `lib/openai.ts` ni se lee `process.env` ni se construye ningún cliente al
 * cargar el módulo. Es a propósito: `governChatBody` es una función pura y se prueba por tabla
 * de entradas y salidas, que es la única forma de comprobar una regla que de otro modo sólo se
 * puede observar mirando qué acabó llegando al proveedor.
 */

/** Proveedores LLM soportados (OpenAI-compatibles todos). */
export type LlmProviderId = "openai" | "gemini" | "anthropic";

export const LLM_PROVIDER_IDS: LlmProviderId[] = ["openai", "gemini", "anthropic"];

/**
 * `baseURL` de cada proveedor. `openai` es `undefined` a propósito: es el default del SDK.
 * Anthropic verificado contra su doc oficial (capa de compatibilidad con el SDK de OpenAI).
 */
export const PROVIDER_BASE_URL: Record<LlmProviderId, string | undefined> = {
  openai: undefined,
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  anthropic: "https://api.anthropic.com/v1/",
};

export const PROVIDER_LABEL: Record<LlmProviderId, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  anthropic: "Anthropic",
};

/**
 * Routing por prefijo del id de modelo: el modelo elegido decide el proveedor.
 *
 * Sustituye al `isGeminiModel()` booleano que había: un booleano no puede crecer a tres
 * proveedores sin convertirse en un if anidado, y esta función es además lo que usa el modo
 * BYOK para saber QUÉ credencial del tenant hay que buscar.
 *
 * Un id desconocido (o ausente) cae en "openai", que es el comportamiento histórico: el
 * `rawCreateForModel` anterior mandaba a OpenAI todo lo que no empezara por "gemini".
 */
export function providerForModel(model?: string | null): LlmProviderId {
  if (typeof model !== "string") return "openai";
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("claude")) return "anthropic";
  return "openai";
}

/** Type guard para validar un proveedor que llega del borde (params de ruta, body). */
export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return typeof value === "string" && (LLM_PROVIDER_IDS as string[]).includes(value);
}

/**
 * Aplica la gobernanza de parámetros a un body de `chat.completions`. Pura: no toca red, no
 * lee env, no muta el body de entrada.
 *
 * Reglas, y el motivo de cada una:
 *  - `reasoning_effort` se manda SÓLO si el modelo lo soporta (tabla de capacidades) y SÓLO
 *    sin function tools: los dos proveedores razonadores devuelven 400 con effort+tools.
 *  - En modelos razonadores se ELIMINA `temperature`: sólo admiten el default (1) y una
 *    temperature personalizada rompe con 400. Los no razonadores (gpt-4*, claude*) conservan
 *    la suya.
 *
 * @param defaultEffort effort a usar si el body no trae uno propio (override por agente).
 */
export function governChatBody<T extends Record<string, any>>(
  body: T,
  defaultEffort?: string | null
): T {
  const model: string | undefined = body?.model;
  const patched: any = { ...body };

  if (!body?.tools) {
    const eff = resolveEffort(model, (body?.reasoning_effort ?? defaultEffort) as any);
    if (eff) patched.reasoning_effort = eff;
    else delete patched.reasoning_effort;
  } else {
    delete patched.reasoning_effort;
  }

  if (modelSupportsEffort(model) && "temperature" in patched) delete patched.temperature;

  return patched as T;
}

/**
 * Construye un cliente OpenAI-compatible para un proveedor con una clave concreta, con
 * `chat.completions.create` ya gobernado por `governChatBody`.
 *
 * Es la vía del modo BYOK (una instancia por tenant y proveedor) y comparte la regla con el
 * cliente global, que llama a la misma `governChatBody`.
 *
 * Nota sobre el `bind`: hay que enlazar el `create` original ANTES de sobrescribirlo, o el
 * wrapper se llamaría a sí mismo. Es el mismo cuidado que ya tenía el parche global.
 */
export function createGovernedClient(params: {
  provider: LlmProviderId;
  apiKey: string;
  defaultEffort?: () => string | null | undefined;
}): OpenAI {
  const { provider, apiKey, defaultEffort } = params;
  const client = new OpenAI({ apiKey, baseURL: PROVIDER_BASE_URL[provider] });
  const rawCreate = client.chat.completions.create.bind(client.chat.completions);

  client.chat.completions.create = ((body: any, options?: any) =>
    rawCreate(governChatBody(body, defaultEffort?.()), options)) as typeof client.chat.completions.create;

  return client;
}
