/**
 * Catálogo vivo de modelos (S1-S3 de model-catalog).
 *
 * El catálogo deja de ser una tabla escrita a mano: el back lee de pi.dev la lista de cada
 * proveedor y la cruza con lo que el proveedor sirve de verdad. Este fichero guarda el ESTADO
 * (última lista buena por proveedor, con su `etag`) y las funciones puras de traducción de la
 * respuesta de pi.dev. Lo que habla por red vive en `catalog-sources.ts`.
 *
 * Por qué el estado está aquí y no en la base de datos: el catálogo es caché de una fuente
 * externa (pi.dev), no un dato de negocio. Un `select` por petición a la BD para algo que cambia
 * cada 4 h sería una consulta por cada apertura de selector; y una migración para guardar una
 * copia de un JSON ajeno no aporta nada que el refresco al arrancar no recupere. El precio es que
 * un reinicio arranca sin catálogo hasta el primer refresco (no bloqueante: mientras tanto
 * responde el respaldo estático de `model-capabilities.ts`).
 *
 * A propósito NO se importa aquí `lib/model-capabilities.ts` (que sí importa este módulo) ni
 * `lib/llm/governance.ts`: es la hoja del grafo, y así no hay ciclos de importación.
 */
import type { Effort } from "@/lib/model-capabilities";

/**
 * Proveedores del catálogo. `gemini` es el id NUESTRO del proveedor `google` de pi.dev; el mapeo
 * vive en `catalog-sources.ts` (`PI_DEV_PROVIDER_SLUG`) porque es un detalle de la fuente.
 *
 * DeepSeek NO está (S4 corregido): sus modelos llegan como modelos de `nanbuilders`
 * (`nan/deepseek-…`), que es lo que los sirve, no como proveedor propio.
 */
export type CatalogProviderId = "openai" | "gemini" | "anthropic" | "nanbuilders";

/** Orden en el que el catálogo (y el endpoint) presenta los proveedores. */
export const CATALOG_PROVIDER_IDS: CatalogProviderId[] = [
  "openai",
  "gemini",
  "anthropic",
  "nanbuilders",
];

/**
 * Un modelo del catálogo. Es la forma que sale por `GET /api/models` (S7): exactamente estos
 * campos, y NINGUNO de precio. `cost` de pi.dev se descarta al parsear (S1: "no necesito los
 * precios"), no se guarda y no hay forma de que se cuele en una respuesta.
 */
export interface CatalogModel {
  id: string;
  name: string;
  provider: CatalogProviderId;
  reasoning: boolean;
  /** Niveles de razonamiento aceptados (de `thinkingLevelMap`, S6). Vacío = no razonador. */
  efforts: Effort[];
  defaultEffort: Effort | null;
  contextWindow: number | null;
  /** true si se cruzó con la lista del proveedor; false si no hay clave o el cruce falló. */
  verified: boolean;
}

/** Un proveedor con sus modelos: la unidad de respuesta de `GET /api/models`. */
export interface CatalogProvider {
  id: CatalogProviderId;
  name: string;
  models: CatalogModel[];
}

/** Lo que se guarda por proveedor: la última lista buena, su etag y cuándo llegó. */
export interface ProviderSlot {
  name: string;
  etag: string | null;
  models: CatalogModel[];
  updatedAt: Date;
}

/**
 * Niveles que el back sabe enviar hoy, en orden canónico (de menos a más).
 *
 * `max` NO está, y la decisión se revisó al pasar todo OpenAI a `/v1/responses` (T2, S5):
 *  - El tipo `ReasoningEffort` del SDK (node_modules/openai/resources/shared.d.ts) declara sólo
 *    `low | medium | high`; va por detrás de la API, que en los `gpt-5*` acepta además `none` y
 *    `xhigh`. Esos dos sí se mandan (están verificados por sonda contra la API y ya viajan hoy
 *    como `reasoning_effort`; en Responses viajan como `reasoning.effort`).
 *  - `max` no está en el tipo del SDK, no está en la tabla verificada de `model-capabilities.ts` y
 *    no se ha probado contra `/v1/responses`. Ofrecerlo en el selector sería prometer un effort
 *    que ningún camino del back puede mandar con la garantía de que el proveedor lo acepta.
 *
 * Quien decide qué nivel sale para cada modelo es `resolveEffort` (catálogo del modelo, nunca el
 * pedido tal cual), así que un `max` que llegue del borde cae a su default en vez de producir un 400.
 */
export const EFFORT_LEVELS: Effort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];

const slots = new Map<CatalogProviderId, ProviderSlot>();

/** Traduce `thinkingLevelMap` de pi.dev a los niveles que el back puede enviar (S6). */
export function effortsFromThinkingLevelMap(map: unknown): Effort[] {
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  const presentes = new Set<string>();
  for (const valor of Object.values(map as Record<string, unknown>)) {
    if (typeof valor !== "string") continue;
    // pi.dev usa `off` para "sin razonamiento"; nuestro vocabulario lo llama `none`.
    presentes.add(valor === "off" ? "none" : valor);
  }
  return EFFORT_LEVELS.filter((nivel) => presentes.has(nivel));
}

/**
 * Effort por defecto de un razonador (S6: `low`).
 *
 * Si el modelo no acepta `low` (Gemini no tiene `none`, pero sí `low`; algún modelo futuro podría
 * no listarlo) se usa el primer nivel que sí acepta: un default que el modelo rechaza es un 400
 * garantizado en cada llamada.
 */
export function defaultEffortFor(efforts: Effort[]): Effort | null {
  if (efforts.length === 0) return null;
  return efforts.includes("low") ? "low" : efforts[0];
}

/** Modelo ya traducido, sin proveedor ni `verified`: eso lo decide quien lo coloca. */
export type ParsedCatalogModel = Omit<CatalogModel, "provider" | "verified">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normaliza las TRES formas con las que puede llegar una lista de modelos:
 *
 *  1. un array (`[ {...}, {...} ]`) — la forma documentada de pi.dev,
 *  2. `{ models: [...] }` — la forma de un listado envuelto,
 *  3. un objeto de objetos indexado por id (`{ "gpt-5.4": {...} }`).
 *
 * También sirve para la lista de `/models` de un proveedor, que suele venir como `{ data: [...] }`
 * (formato OpenAI). Una respuesta con otra forma (un error, un HTML) devuelve `[]`: un catálogo
 * vacío es un catálogo que no filtra nada, y eso es preferible a reventar el refresco.
 */
export function modelRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  for (const clave of ["models", "data"]) {
    const valor = payload[clave];
    if (Array.isArray(valor)) return valor.filter(isRecord);
  }

  // Objeto de objetos: `{ "<id>": {...}, ... }`. Sólo las entradas con objeto dentro son
  // modelos; un `{ error: "boom" }` no es un catálogo vacío con un modelo llamado "error".
  const entradas = Object.entries(payload).filter(([, valor]) => isRecord(valor));
  return entradas.map(([id, valor]) => {
    const registro = valor as Record<string, unknown>;
    return { ...registro, id: typeof registro.id === "string" ? registro.id : id };
  });
}
/**
 * Traduce la respuesta de pi.dev a modelos del catálogo.
 *
 * Dos descartes deliberados:
 *  - `cost`: no se copia nunca (S1).
 *  - todo lo que no sea `type: "chat"` (S2). Un embedding o un modelo de imagen en el selector
 *    de chat es una llamada que el proveedor rechaza.
 */
export function parsePiDevModels(payload: unknown): ParsedCatalogModel[] {
  const modelos: ParsedCatalogModel[] = [];

  for (const registro of modelRecords(payload)) {
    const id = typeof registro.id === "string" ? registro.id.trim() : "";
    if (!id) continue;

    const tipo = typeof registro.type === "string" ? registro.type.toLowerCase() : null;
    if (tipo && tipo !== "chat") continue;

    const efforts = effortsFromThinkingLevelMap(registro.thinkingLevelMap);
    const reasoning = registro.reasoning === true || efforts.length > 0;

    modelos.push({
      id,
      name: typeof registro.name === "string" && registro.name.trim() ? registro.name : id,
      reasoning,
      efforts,
      defaultEffort: reasoning ? defaultEffortFor(efforts) : null,
      contextWindow: typeof registro.contextWindow === "number" ? registro.contextWindow : null,
    });
  }

  return modelos;
}

/** Guarda la última lista buena de un proveedor (y su etag). */
export function rememberProvider(
  provider: CatalogProviderId,
  slot: { name: string; etag: string | null; models: CatalogModel[] }
): void {
  slots.set(provider, { ...slot, updatedAt: new Date() });
}

/** Olvida un proveedor (NanBuilders deja de aparecer cuando se desconfigura). */
export function forgetProvider(provider: CatalogProviderId): void {
  slots.delete(provider);
}

/** `etag` guardado del proveedor, para mandarlo como `if-none-match`. */
export function providerEtag(provider: CatalogProviderId): string | null {
  return slots.get(provider)?.etag ?? null;
}

/** ¿Hay catálogo vivo de este proveedor? (false = toca el respaldo estático para sus modelos). */
export function hasProviderCatalog(provider: CatalogProviderId): boolean {
  return slots.has(provider);
}

/** ¿Se ha descargado alguna vez el catálogo? (false = respaldo estático completo). */
export function hasLiveCatalog(): boolean {
  return slots.size > 0;
}

/** Catálogo vivo agrupado por proveedor, en el orden de `CATALOG_PROVIDER_IDS`. */
export function liveCatalogProviders(): CatalogProvider[] {
  return CATALOG_PROVIDER_IDS.flatMap((id) => {
    const slot = slots.get(id);
    if (!slot) return [];
    return [{ id, name: slot.name, models: slot.models.map((m) => ({ ...m })) }];
  });
}

/** Todos los modelos del catálogo vivo, sin agrupar (búsquedas por id). */
export function liveCatalogModels(): CatalogModel[] {
  return [...slots.values()].flatMap((slot) => slot.models);
}

/** Un modelo del catálogo vivo por id, o `undefined` si ese id no está. */
export function catalogModelById(id: string): CatalogModel | undefined {
  for (const slot of slots.values()) {
    const modelo = slot.models.find((m) => m.id === id);
    if (modelo) return modelo;
  }
  return undefined;
}

/** Vacía el catálogo. Sólo para pruebas (el proceso real sólo pierde el catálogo al reiniciar). */
export function resetModelCatalog(): void {
  slots.clear();
}
