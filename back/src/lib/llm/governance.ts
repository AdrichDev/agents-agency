import OpenAI from "openai";
import { resolveEffort, modelSupportsEffort } from "@/lib/model-capabilities";
import { createChatCompletionViaResponses, responsesCreateOf } from "@/lib/llm/responses-compat";

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
export type LlmProviderId = "openai" | "gemini" | "anthropic" | "nanbuilders";

export const LLM_PROVIDER_IDS: LlmProviderId[] = ["openai", "gemini", "anthropic", "nanbuilders"];

/**
 * Base URL de nanBuilders, leída del entorno en cada llamada (no al importar): así el
 * despliegue puede definirla y las pruebas no dependen del orden de carga de módulos.
 * `null` cuando no está configurada — y entonces NO se usa (ver `createGovernedClient`):
 * caer a OpenAI con la clave de otro proveedor sería un fallo silencioso y caro.
 */
export function nanBuildersBaseUrl(
  raw: string | undefined = process.env.NANBUILDERS_BASE_URL,
): string | null {
  const base = (raw ?? "").trim();
  return base ? base : null;
}

/**
 * Prefijos de modelo que enrutan a nanBuilders. Configurables porque el catálogo de un
 * proveedor cambia; por defecto `nan`, `nb` y `nanbuilders`.
 */
export function nanBuildersModelPrefixes(
  raw: string | undefined = process.env.NANBUILDERS_MODEL_PREFIXES,
): string[] {
  const list = (raw ?? "").split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : ["nan", "nb", "nanbuilders"];
}

/**
 * `baseURL` de cada proveedor. `openai` es `undefined` a propósito: es el default del SDK.
 * Anthropic verificado contra su doc oficial (capa de compatibilidad con el SDK de OpenAI).
 */
export const PROVIDER_BASE_URL: Record<LlmProviderId, string | undefined> = {
  openai: undefined,
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  anthropic: "https://api.anthropic.com/v1/",
  get nanbuilders() {
    // Getter: se resuelve al usarlo, no al cargar el módulo (mismo motivo que el resto).
    return nanBuildersBaseUrl() ?? undefined;
  },
};

export const PROVIDER_LABEL: Record<LlmProviderId, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  anthropic: "Anthropic",
  nanbuilders: "nanBuilders",
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
  const id = model.toLowerCase();
  // nanBuilders primero: sus prefijos (`nan`, `nb`) no colisionan con los demás.
  if (nanBuildersModelPrefixes().some((prefix) => id.startsWith(prefix))) return "nanbuilders";
  if (id.startsWith("gemini")) return "gemini";
  if (id.startsWith("claude")) return "anthropic";
  return "openai";
}

/** Type guard para validar un proveedor que llega del borde (params de ruta, body). */
export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return typeof value === "string" && (LLM_PROVIDER_IDS as string[]).includes(value);
}

/**
 * S5 (model-catalog) — ¿esta petición va por la Responses API de OpenAI?
 *
 * Decisión de producto: "Todos por Responses API". La pregunta NO es "¿este modelo sólo funciona
 * en `/v1/responses`?" (que era el caso de `gpt-5.6-luna`) sino "¿de quién es este modelo?": todo
 * lo que enruta a OpenAI sale por ahí, y Gemini, Anthropic, nanBuilders y el runtime OpenClaw
 * siguen exactamente por `chat.completions`.
 *
 * Vive aquí, junto a `providerForModel`, y no en `model-capabilities.ts`, por una razón concreta:
 * la respuesta depende del enrutado por proveedor, que vive en este módulo, y `model-capabilities`
 * ya es importado por él — ponerla allí crearía un ciclo de importación entre los dos.
 *
 * Sin id de modelo devuelve false a propósito: `providerForModel(undefined)` cae en "openai"
 * (comportamiento histórico del enrutado), pero sin modelo no hay petición que enrutar y nunca se
 * debe cambiar de endpoint por accidente.
 *
 * El runtime OpenClaw NO se decide aquí: su target (`openclaw/...`) no empieza por gemini/claude/nan
 * y por tanto se clasificaría como OpenAI, pero su gateway sólo habla `chat.completions`. Quien
 * pregunta debe mirar `isOpenclaw` ANTES (`agent/engine.ts`, `agent/lead-intent.ts`).
 */
export function usesResponsesApi(model?: string | null): boolean {
  if (typeof model !== "string" || !model) return false;
  return providerForModel(model) === "openai";
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
 * `chat.completions.create` ya gobernado.
 *
 * Es la vía del modo BYOK (una instancia por tenant y proveedor) y comparte la regla con el
 * cliente global, que llama a la misma `governChatBody`.
 *
 * S5 (model-catalog): si el proveedor es OpenAI, el `create` de chat pasa por el adaptador
 * `llm/responses-compat.ts` y la petición viaja de verdad por `/v1/responses`. Se conserva la
 * puerta `chat.completions.create` porque es lo que usan todos los llamadores (bucle incluido) y
 * porque así el cliente BYOK y el global no pueden tomar caminos distintos: si divergieran, el
 * síntoma sería un 400 del proveedor SÓLO para los clientes que traen su propia clave.
 *
 * Nota sobre el `bind`: hay que enlazar los `create` originales ANTES de sobrescribirlos, o el
 * wrapper se llamaría a sí mismo. Es el mismo cuidado que ya tenía el parche global.
 */
export function createGovernedClient(params: {
  provider: LlmProviderId;
  apiKey: string;
  defaultEffort?: () => string | null | undefined;
}): OpenAI {
  const { provider, apiKey, defaultEffort } = params;
  const baseURL = PROVIDER_BASE_URL[provider];
  if (provider === "nanbuilders" && !baseURL) {
    // Fail-closed: sin destino propio se lanzaría contra OpenAI con una clave ajena.
    throw new Error(
      "nanBuilders está seleccionado pero falta NANBUILDERS_BASE_URL. Configúrala (p. ej. " +
        "https://api.nanbuilders.example/v1) o elige otro modelo.",
    );
  }
  const client = new OpenAI({ apiKey, baseURL });
  const rawCreate = client.chat.completions.create.bind(client.chat.completions);
  const rawResponsesCreate = provider === "openai" ? responsesCreateOf(client) : null;

  client.chat.completions.create = ((body: any, options?: any) => {
    if (rawResponsesCreate) {
      return createChatCompletionViaResponses({
        create: rawResponsesCreate,
        body,
        defaultEffort: defaultEffort?.(),
        options,
      });
    }
    return rawCreate(governChatBody(body, defaultEffort?.()), options);
  }) as typeof client.chat.completions.create;

  return client;
}
