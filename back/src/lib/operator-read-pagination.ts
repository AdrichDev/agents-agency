// ---------------------------------------------------------------------------
// Paginación en SERVIDOR de los listados de lectura del Operator Agent
// (T5, odd/tasks/mcp-plataforma-read-surface, S2/S13).
//
// La paginación es ADITIVA. Mientras la petición no traiga `limit` ni `offset`,
// los endpoints de clientes/contactos/agenda responden EXACTAMENTE como antes
// (array legacy, objeto legacy, parámetros desconocidos ignorados). En cuanto
// llega cualquiera de los dos, el listado se resuelve en la BASE DE DATOS con
// skip/take + count (nunca trayendo la tabla entera para recortarla en memoria).
//
// Lo que este módulo NO hace: no decide el orden (cada listado fija su orden
// estable con desempate por `id`), no toca filtros y no escribe nada.
// ---------------------------------------------------------------------------

/** Techo duro de filas por página (S13): por encima es un 400, nunca un recorte. */
export const LIMITE_MAX_PAGINA = 200;
/** Filas por página por defecto cuando se pide paginación sin `limit`. */
export const LIMITE_DEFECTO_PAGINA = 20;

/** Paginación ya validada y lista para `skip`/`take`. */
export interface Paginacion {
  limit: number;
  offset: number;
}

export type ResultadoPaginacion =
  | ({ ok: true } & Paginacion)
  | { ok: false; detalle: Record<string, string> };

/**
 * true si la petición activa la ruta paginada. Es el interruptor de
 * compatibilidad: con `false`, los handlers siguen su camino legacy intacto.
 */
export function pidePagina(query: Record<string, unknown>): boolean {
  return query.limit !== undefined || query.offset !== undefined;
}

/**
 * Entero escrito sólo con dígitos. Rechaza lo que `Number()` aceptaría por su
 * cuenta y no es un entero de query: "1.5", "1e3", "0x10", " 5", "-1", "" y los
 * arrays (`?limit=1&limit=2`). Devuelve null si no es un entero seguro.
 */
function enteroDeQuery(valor: unknown): number | null {
  if (typeof valor !== "string" || !/^\d+$/.test(valor)) return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) ? numero : null;
}

/**
 * Valida `limit` (entero 1..200, defecto 20) y `offset` (entero >= 0, defecto 0).
 * Los errores se devuelven por campo para que el 400 explique cuál falló.
 */
export function parsearPaginacion(query: Record<string, unknown>): ResultadoPaginacion {
  const detalle: Record<string, string> = {};

  let limit = LIMITE_DEFECTO_PAGINA;
  if (query.limit !== undefined) {
    const numero = enteroDeQuery(query.limit);
    if (numero === null || numero < 1 || numero > LIMITE_MAX_PAGINA) {
      detalle.limit = `limit debe ser un entero entre 1 y ${LIMITE_MAX_PAGINA}`;
    } else {
      limit = numero;
    }
  }

  let offset = 0;
  if (query.offset !== undefined) {
    const numero = enteroDeQuery(query.offset);
    if (numero === null) detalle.offset = "offset debe ser un entero >= 0";
    else offset = numero;
  }

  if (Object.keys(detalle).length > 0) return { ok: false, detalle };
  return { ok: true, limit, offset };
}

/** Metadatos de la página que acompañan a las filas en la respuesta. */
export interface MetaPagina {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
}

/**
 * Construye los metadatos de la página.
 *
 * `offset` se devuelve TAL CUAL se pidió (nunca se recorta al total) y una
 * página vacía SIEMPRE cierra la paginación (`hasMore:false`, `nextOffset:null`):
 * así el cliente no se queda pidiendo el mismo cursor vacío en bucle.
 *
 * Esto no promete una foto transaccional: el `count` y las filas son dos
 * consultas, así que una escritura concurrente puede mover el total entre
 * ambas. Sólo promete orden estable y metadatos coherentes con lo devuelto.
 */
export function metaDePagina(args: {
  total: number;
  devueltos: number;
  limit: number;
  offset: number;
}): MetaPagina {
  const { total, devueltos, limit, offset } = args;
  const hasMore = devueltos > 0 && offset + devueltos < total;
  return { total, limit, offset, hasMore, nextOffset: hasMore ? offset + devueltos : null };
}

/** Cuerpo de error 400 para una paginación inválida (misma forma en los 3 listados). */
export function paginacionInvalida(detalle: Record<string, string>) {
  return {
    error: {
      code: "VALIDATION_ERROR",
      message: "Parámetros de paginación no válidos",
      detalle,
    },
  };
}
