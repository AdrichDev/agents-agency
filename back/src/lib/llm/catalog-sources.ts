/**
 * Fuentes del catálogo vivo de modelos (S1-S3 de model-catalog): pi.dev, la lista de cada
 * proveedor y NanBuilders. Aquí está lo que habla por red; el estado vive en `catalog.ts` y las
 * capacidades estáticas en `model-capabilities.ts`.
 *
 * Tres reglas gobiernan este fichero, y las tres son de disponibilidad, no de elegancia:
 *
 *  1. **Ningún fallo rompe nada.** El catálogo es una comodidad: si pi.dev no contesta, el back
 *     sigue arrancando, el selector sigue teniendo una lista (la última buena o la estática) y los
 *     agentes siguen respondiendo. Por eso cada proveedor se refresca en su propio `try`.
 *  2. **Se guarda lo último bueno, y sólo se pisa con un 200.** Un 304 no cambia nada (la lista
 *     sigue siendo la misma por definición) y un 500 no borra lo que ya se tenía.
 *  3. **Sin clave de plataforma no se filtra.** Marcar `verified: false` es decir la verdad (no se
 *     ha cruzado nada); filtrar contra una lista que no se puede pedir sería adivinar.
 */
import { logger } from "@/lib/logger";
import { HttpError } from "@/lib/http";
import { PROVIDER_BASE_URL, PROVIDER_LABEL, providerForModel } from "@/lib/llm/governance";
import {
  CATALOG_PROVIDER_IDS,
  catalogModelById,
  forgetProvider,
  hasProviderCatalog,
  hasLiveCatalog,
  liveCatalogProviders,
  modelRecords,
  parsePiDevModels,
  providerEtag,
  rememberProvider,
  type CatalogModel,
  type CatalogProvider,
  type CatalogProviderId,
} from "@/lib/llm/catalog";
import { MODEL_CAPABILITIES } from "@/lib/model-capabilities";

/** Endpoint de pi.dev (el mismo que usa gentle-ai). `?types=chat` filtra en origen. */
export const PI_DEV_MODELS_BASE = "https://pi.dev/api/models/providers";

/**
 * Timeout corto (S1: 4 s). El refresco no bloquea el arranque y el catálogo es caché: esperar más
 * sólo alarga el cron, nunca mejora el resultado.
 */
export const PI_DEV_TIMEOUT_MS = 4_000;

/**
 * Nombre de proveedor en pi.dev. `google` es el caso raro: el proveedor es Google, pero el
 * servicio que usamos (la capa OpenAI-compatible de Gemini) y nuestro id interno son `gemini`.
 * El mapeo se hace aquí, en el borde, para que el resto del sistema no tenga dos nombres.
 */
const PI_DEV_PROVIDER_SLUG: Record<Exclude<CatalogProviderId, "nanbuilders">, string> = {
  openai: "openai",
  gemini: "google",
  anthropic: "anthropic",
  deepseek: "deepseek",
};

/** Variable de entorno con la clave de plataforma de cada proveedor (liveness, S2). */
const PROVIDER_KEY_ENV: Record<CatalogProviderId, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  nanbuilders: "NANBUILDERS_API_KEY",
};

const GEMINI_BASE =
  PROVIDER_BASE_URL.gemini ?? "https://generativelanguage.googleapis.com/v1beta/openai/";
const ANTHROPIC_BASE = PROVIDER_BASE_URL.anthropic ?? "https://api.anthropic.com/v1/";
/** Base de DeepSeek, ahora que S4 la declaró en `governance.ts`: una sola fuente, con `/` final. */
const DEEPSEEK_BASE = `${PROVIDER_BASE_URL.deepseek ?? "https://api.deepseek.com"}/`;

/**
 * Etiqueta legible de cada proveedor, tomada de `PROVIDER_LABEL`. No se reescribe ninguna: un
 * selector que dice "nanBuilders" en un sitio y "NanBuilders" en otro es el síntoma de una tabla
 * duplicada, y DeepSeek (S4) nació ya dentro de `PROVIDER_LABEL` para no crear la segunda.
 */
const PROVIDER_DISPLAY_NAME: Record<CatalogProviderId, string> = {
  openai: PROVIDER_LABEL.openai,
  gemini: PROVIDER_LABEL.gemini,
  anthropic: PROVIDER_LABEL.anthropic,
  deepseek: PROVIDER_LABEL.deepseek,
  nanbuilders: PROVIDER_LABEL.nanbuilders,
};

/** Respuesta HTTP mínima que necesita el refresco (sólo lo que se usa, para poder inyectarlo). */
export interface CatalogHttpResponse {
  status: number;
  etag: string | null;
  body: unknown;
}

/** Cliente HTTP inyectable: las pruebas no tocan la red y el proceso real usa `fetch`. */
export type CatalogHttp = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<CatalogHttpResponse>;

/** Entorno inyectable (por defecto `process.env`), para no depender del orden de carga. */
export type CatalogEnv = Record<string, string | undefined>;

export interface CatalogDeps {
  http?: CatalogHttp;
  env?: CatalogEnv;
}

export interface CatalogRefreshSummary {
  updated: CatalogProviderId[];
  unchanged: CatalogProviderId[];
  failed: CatalogProviderId[];
}

const defaultCatalogHttp: CatalogHttp = async (url, init) => {
  const res = await fetch(url, {
    headers: init.headers,
    signal: AbortSignal.timeout(PI_DEV_TIMEOUT_MS),
  });
  return {
    status: res.status,
    etag: res.headers.get("etag"),
    // Un 304 no trae cuerpo; leerlo rompería el refresco de un proveedor que, por lo demás, está
    // perfectamente al día.
    body: res.status === 304 ? null : await res.json().catch(() => null),
  };
};

/**
 * URL de la lista de modelos que SIRVE el proveedor (el cruce de S2).
 *
 * Es el mismo `GET /models` que usa `models.list()` del SDK de OpenAI: aquí se pide con `fetch`
 * para que las cuatro comprobaciones de liveness compartan una sola forma y no haya dos familias
 * de cliente que se desincronicen. Se reutilizan las bases de `governance.ts` donde ya existen.
 */
export function providerModelsUrl(provider: Exclude<CatalogProviderId, "nanbuilders">): string {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1/models";
    case "gemini":
      return `${GEMINI_BASE}models`;
    case "anthropic":
      return `${ANTHROPIC_BASE}models`;
    case "deepseek":
      return `${DEEPSEEK_BASE}models`;
  }
}

/**
 * Ids de modelo de una respuesta de `/models` (OpenAI, Gemini, Anthropic, DeepSeek, NanBuilders).
 * Gemini devuelve los ids como `models/<id>` en su capa OpenAI-compatible; se quita el prefijo para
 * compararlos con los de pi.dev (sin esto, el cruce de vivos dejaba Gemini vacío).
 */
export function extractModelIds(payload: unknown): string[] {
  return modelRecords(payload)
    .map((registro) => (typeof registro.id === "string" ? registro.id.trim() : ""))
    .map((id) => id.replace(/^models\//, ""))
    .filter(Boolean);
}

/**
 * Id con el que se llama a NanBuilders: el que ya enruta allí se deja tal cual y al resto se le
 * pone el prefijo por defecto (`nan/`). El modelo viaja con ese prefijo al proveedor (el cliente
 * sólo lo usa para enrutar), así que el id que se ofrece es exactamente el que se enviará.
 */
export function routableNanBuildersId(id: string): string {
  return providerForModel(id) === "nanbuilders" ? id : `nan/${id}`;
}

/**
 * Cruza la lista de pi.dev con lo que el proveedor sirve de verdad (S2).
 *
 * Sin clave de plataforma no hay nada que preguntar: se devuelve la lista tal cual y con
 * `verified: false`. Con clave, si la consulta falla también se devuelve tal cual (fail-soft): es
 * preferible ofrecer un modelo que puede estar retirado a quedarse sin catálogo por un 500.
 */
async function applyLiveness(
  provider: Exclude<CatalogProviderId, "nanbuilders">,
  models: CatalogModel[],
  http: CatalogHttp,
  env: CatalogEnv
): Promise<CatalogModel[]> {
  const apiKey = (env[PROVIDER_KEY_ENV[provider]] ?? "").trim();
  if (!apiKey) return models;

  const url = providerModelsUrl(provider);
  try {
    const res = await http(url, {
      headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
    });
    if (res.status !== 200) throw new Error(`${url} respondió ${res.status}`);

    const served = new Set(extractModelIds(res.body));
    return models.filter((m) => served.has(m.id)).map((m) => ({ ...m, verified: true }));
  } catch (e) {
    logger.warn(
      { err: e, provider },
      "[model-catalog] no se pudo listar los modelos del proveedor; se conserva la lista sin filtrar"
    );
    return models;
  }
}

async function refreshFromPiDev(
  provider: Exclude<CatalogProviderId, "nanbuilders">,
  http: CatalogHttp,
  env: CatalogEnv
): Promise<"updated" | "unchanged"> {
  const slug = PI_DEV_PROVIDER_SLUG[provider];
  const etag = providerEtag(provider);

  const headers: Record<string, string> = { accept: "application/json" };
  if (etag) headers["if-none-match"] = etag;

  const res = await http(`${PI_DEV_MODELS_BASE}/${slug}?types=chat`, { headers });
  if (res.status === 304) return "unchanged";
  if (res.status !== 200) throw new Error(`pi.dev respondió ${res.status} para ${slug}`);

  const parsed = parsePiDevModels(res.body).map<CatalogModel>((modelo) => ({
    ...modelo,
    provider,
    verified: false,
  }));

  const models = await applyLiveness(provider, parsed, http, env);
  rememberProvider(provider, { name: PROVIDER_DISPLAY_NAME[provider], etag: res.etag, models });
  return "updated";
}

async function refreshNanBuilders(
  http: CatalogHttp,
  env: CatalogEnv
): Promise<"updated" | "unchanged" | "skipped"> {
  const base = (env.NANBUILDERS_BASE_URL ?? "").trim();
  const apiKey = (env.NANBUILDERS_API_KEY ?? "").trim();

  // Fail-soft (S3): sin base o sin clave, NanBuilders simplemente no está en el catálogo.
  if (!base || !apiKey) {
    forgetProvider("nanbuilders");
    return "skipped";
  }

  const cached = providerEtag("nanbuilders");
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  if (cached) headers["if-none-match"] = cached;

  const res = await http(`${base.replace(/\/+$/, "")}/models`, { headers });
  if (res.status === 304) return "unchanged";
  if (res.status !== 200) throw new Error(`NanBuilders respondió ${res.status}`);

  const vistos = new Set<string>();
  const models: CatalogModel[] = [];
  for (const idCrudo of extractModelIds(res.body)) {
    const id = routableNanBuildersId(idCrudo);
    if (vistos.has(id)) continue;
    vistos.add(id);
    models.push({
      id,
      name: idCrudo,
      provider: "nanbuilders",
      reasoning: false,
      efforts: [],
      defaultEffort: null,
      contextWindow: null,
      verified: true,
    });
  }

  rememberProvider("nanbuilders", {
    name: PROVIDER_DISPLAY_NAME.nanbuilders,
    etag: res.etag,
    models,
  });
  return "updated";
}

/**
 * Refresca el catálogo vivo (al arrancar y cada 4 h). Nunca lanza: devuelve qué proveedores se
 * actualizaron, cuáles siguen con la lista buena anterior y cuáles fallaron, para el log del cron.
 */
export async function refreshModelCatalog(deps: CatalogDeps = {}): Promise<CatalogRefreshSummary> {
  const http = deps.http ?? defaultCatalogHttp;
  const env = deps.env ?? process.env;
  const resumen: CatalogRefreshSummary = { updated: [], unchanged: [], failed: [] };

  for (const provider of Object.keys(PI_DEV_PROVIDER_SLUG) as Array<
    Exclude<CatalogProviderId, "nanbuilders">
  >) {
    try {
      const resultado = await refreshFromPiDev(provider, http, env);
      (resultado === "unchanged" ? resumen.unchanged : resumen.updated).push(provider);
    } catch (e) {
      // Se conserva la última lista buena: no se toca el slot.
      resumen.failed.push(provider);
      logger.warn({ err: e, provider }, "[model-catalog] pi.dev falló; se conserva la última lista buena");
    }
  }

  try {
    const resultado = await refreshNanBuilders(http, env);
    if (resultado === "updated") resumen.updated.push("nanbuilders");
    else if (resultado === "unchanged") resumen.unchanged.push("nanbuilders");
  } catch (e) {
    resumen.failed.push("nanbuilders");
    logger.warn({ err: e }, "[model-catalog] NanBuilders falló; se conserva la última lista buena");
  }

  return resumen;
}

/**
 * Respaldo estático (S1: "si nunca hubo una, se usa el catálogo estático actual").
 *
 * Se agrupa por proveedor con `providerForModel`, la MISMA función que enruta las llamadas: si el
 * respaldo agrupara por su cuenta, un modelo podría salir bajo un proveedor y llamarse contra
 * otro. `verified: false` porque aquí no se ha cruzado nada con el proveedor.
 */
export function staticCatalogProviders(): CatalogProvider[] {
  const porProveedor = new Map<CatalogProviderId, CatalogModel[]>();

  for (const [id, caps] of Object.entries(MODEL_CAPABILITIES)) {
    const provider = providerForModel(id);
    const modelo: CatalogModel = {
      id,
      name: id,
      provider,
      reasoning: caps.efforts.length > 0,
      efforts: [...caps.efforts],
      defaultEffort: caps.defaultEffort,
      contextWindow: null,
      verified: false,
    };
    const lista = porProveedor.get(provider) ?? [];
    lista.push(modelo);
    porProveedor.set(provider, lista);
  }

  return CATALOG_PROVIDER_IDS.flatMap((id) => {
    const models = porProveedor.get(id);
    return models ? [{ id, name: PROVIDER_DISPLAY_NAME[id], models }] : [];
  });
}

/**
 * Catálogo que consumen los selectores (S7), proveedor a proveedor: el vivo si lo hay y el
 * estático si ese proveedor nunca ha respondido. Es el mismo criterio de respaldo que usa
 * `isCatalogModel`, y de ahí que vayan juntos: un selector que ofrece lo que la API rechaza (o al
 * revés) es peor que no tener catálogo.
 */
export function buildCatalogResponse(): { providers: CatalogProvider[] } {
  if (!hasLiveCatalog()) return { providers: staticCatalogProviders() };

  const vivos = new Map(liveCatalogProviders().map((p) => [p.id, p]));
  const estaticos = staticCatalogProviders();

  return {
    providers: CATALOG_PROVIDER_IDS.flatMap((id) => {
      const provider = vivos.get(id) ?? estaticos.find((p) => p.id === id);
      return provider ? [provider] : [];
    }),
  };
}

/**
 * ¿Se puede elegir este modelo? (S6: el catálogo vivo es la allowlist.)
 *
 * Tres casos, en este orden:
 *  1. Está en el catálogo vivo de algún proveedor ⇒ sí.
 *  2. Su proveedor tiene catálogo vivo y no lo lista ⇒ NO (es exactamente el modelo retirado).
 *  3. Su proveedor no tiene catálogo vivo (pi.dev nunca respondió por él) ⇒ manda la tabla
 *     estática, que es el respaldo de S1. Sin este caso, un pi.dev caído dejaría el panel sin
 *     poder elegir ni un modelo.
 */
export function isCatalogModel(modelId: string): boolean {
  if (!modelId) return false;
  if (catalogModelById(modelId)) return true;

  const provider = providerForModel(modelId);
  if (hasProviderCatalog(provider)) return false;
  return Object.prototype.hasOwnProperty.call(MODEL_CAPABILITIES, modelId);
}

/**
 * Motivo por el que un modelo NO se puede elegir, o `null` si sí se puede.
 *
 * Existe además de `assertSelectableModel` porque no todas las rutas del back tienen el
 * `errorHandler` central detrás (los estudios de mercado responden sus 400 a mano dentro de un
 * `try`): allí un `throw` en un handler `async` sin `asyncHandler` no llegaría a nadie y dejaría la
 * petición colgada, así que se pide el motivo y se responde con él.
 */
export function catalogModelRejection(modelId: string): HttpError | null {
  if (isCatalogModel(modelId)) return null;
  return new HttpError(
    400,
    `El modelo "${modelId}" no está en el catálogo vivo. Elige otro de GET /api/models.`,
    "MODEL_NOT_IN_CATALOG"
  );
}

/**
 * Rechaza un modelo que no se puede elegir, con un mensaje accionable y un `code` estable para que
 * el panel (y el CRM) puedan distinguirlo de un error de validación cualquiera.
 */
export function assertSelectableModel(modelId: string): void {
  const rechazo = catalogModelRejection(modelId);
  if (rechazo) throw rechazo;
}
