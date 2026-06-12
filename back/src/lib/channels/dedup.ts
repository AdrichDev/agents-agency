/**
 * Registro en memoria de IDs procesados para idempotencia de webhooks.
 * TTL de 24 horas. Limpieza perezosa al marcar nuevas entradas.
 *
 * Tradeoff (AD4): los IDs se pierden al reiniciar el proceso.
 * Un reinicio puede causar, como mucho, un mensaje duplicado por conversación.
 * Aceptable para el volumen esperado; si escala, promover a tabla ProcessedUpdate.
 */

const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

/** Mapa: clave → timestamp de registro */
const store = new Map<string, number>();

/** Limpieza perezosa de entradas expiradas. */
function purgeExpired(now: number): void {
  for (const [key, ts] of store) {
    if (now - ts > TTL_MS) store.delete(key);
  }
}

/** Devuelve true si la clave ya fue procesada (y no expiró). */
export function wasProcessed(key: string, now = Date.now()): boolean {
  const ts = store.get(key);
  if (ts === undefined) return false;
  if (now - ts > TTL_MS) {
    store.delete(key);
    return false;
  }
  return true;
}

/** Registra la clave como procesada. */
export function markProcessed(key: string, now = Date.now()): void {
  purgeExpired(now);
  store.set(key, now);
}
