/**
 * Buffer de mensajes entrantes por conversación.
 *
 * Un cliente rara vez escribe un párrafo: escribe "hola", "oye", "una
 * pregunta", "¿abrís los sábados?" en cuatro mensajes seguidos. Sin buffer el
 * agente responde cuatro veces, y las tres primeras contestan a una intención
 * incompleta. Con buffer espera a que termine, agrupa y responde una vez.
 *
 * Estado EN MEMORIA (AD1), mismo criterio que `dedup.ts`: escribir una fila por
 * cada mensaje entrante sólo para aplazar la respuesta unos segundos no se paga
 * solo. Se aceptan dos consecuencias:
 *
 *   - Reinicio del proceso durante la ventana → mensajes pendientes perdidos.
 *     Mitigado con `flushAllInbound()` en SIGTERM/SIGINT (AD3).
 *   - Multi-instancia → dos réplicas pueden partirse los mensajes de un mismo
 *     cliente y responder dos veces. Eso es EXACTAMENTE el comportamiento de
 *     hoy: degrada al estado anterior, nunca por debajo.
 *
 * Si algún día hay volumen que lo justifique, la promoción natural es una tabla
 * `PendingInbound` con lock por conversación.
 */

import { logger } from "@/lib/logger";

/** Techo de la ventana de agrupación (AD5). */
export const INBOUND_BUFFER_MAX_MS = 30_000;

/**
 * Al llegar a este número de mensajes acumulados se dispara el flush aunque la
 * ventana no haya vencido: un cliente que escribe sin parar no puede diferir su
 * respuesta indefinidamente (AD5).
 */
export const INBOUND_BUFFER_MAX_MESSAGES = 10;

/** Recibe los textos acumulados, en orden de llegada. */
export type InboundFlush = (texts: string[]) => Promise<void>;

interface BufferEntry {
  texts: string[];
  timer: NodeJS.Timeout;
  /** Tope absoluto desde el primer mensaje del grupo. */
  deadline: number;
  flush: InboundFlush;
}

const buffers = new Map<string, BufferEntry>();

/**
 * Recorta la ventana configurada a los límites válidos.
 * `0` (o cualquier valor no positivo) significa buffer desactivado.
 *
 * El recorte se hace AL LEER y no al guardar, para que bajar el tope en el
 * futuro afecte también a los agentes ya configurados (AD5).
 */
export function clampBufferWindowMs(ms: number | null | undefined): number {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(Math.trunc(ms), INBOUND_BUFFER_MAX_MS);
}

/** Clave canónica del buffer. Aísla por canal, agente y chat externo (AC6). */
export function inboundKey(channel: string, agentId: string, externalId: string): string {
  return `${channel}:${agentId}:${externalId}`;
}

/** Dispara el flush de una clave y la saca del mapa. */
function fire(key: string): void {
  const entry = buffers.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  // Borrar ANTES de invocar el flush: los mensajes que lleguen mientras el LLM
  // responde abren una ventana nueva en vez de colarse en un grupo ya
  // despachado (y que por tanto nunca se enviaría).
  buffers.delete(key);
  void entry.flush(entry.texts).catch((e) => {
    logger.error({ err: e, key }, "[channels/buffer] error en flush:");
  });
}

/**
 * Acumula `text` bajo `key` y programa el flush.
 *
 * Cada mensaje nuevo reinicia la ventana (debounce), pero nunca más allá del
 * tope absoluto del grupo. `flush` se guarda en cada llamada porque lleva
 * dentro las credenciales del canal, que se resuelven por petición.
 */
export function bufferInbound(
  key: string,
  text: string,
  windowMs: number,
  flush: InboundFlush
): void {
  const window = clampBufferWindowMs(windowMs);
  const now = Date.now();
  const existing = buffers.get(key);

  if (!existing) {
    const entry: BufferEntry = {
      texts: [text],
      deadline: now + INBOUND_BUFFER_MAX_MS,
      flush,
      timer: setTimeout(() => fire(key), window),
    };
    buffers.set(key, entry);
    return;
  }

  existing.texts.push(text);
  existing.flush = flush;
  clearTimeout(existing.timer);

  if (existing.texts.length >= INBOUND_BUFFER_MAX_MESSAGES) {
    fire(key);
    return;
  }

  const wait = Math.max(0, Math.min(window, existing.deadline - now));
  existing.timer = setTimeout(() => fire(key), wait);
}

/**
 * Vacía todo lo pendiente. Se registra en SIGTERM/SIGINT (AD3): sin esto, un
 * deploy —que en Render es rutina— durante la ventana deja al cliente esperando
 * una respuesta que no llega nunca, que es peor que el problema que resolvemos.
 *
 * No garantiza la entrega: garantiza que el fallo sea raro y no silencioso.
 * Devuelve cuántos grupos se dispararon.
 */
export async function flushAllInbound(timeoutMs = 10_000): Promise<number> {
  const keys = [...buffers.keys()];
  if (keys.length === 0) return 0;

  const pending: Promise<unknown>[] = [];
  for (const key of keys) {
    const entry = buffers.get(key);
    if (!entry) continue;
    clearTimeout(entry.timer);
    buffers.delete(key);
    pending.push(
      entry.flush(entry.texts).catch((e) => {
        logger.error({ err: e, key }, "[channels/buffer] error en flush de apagado:");
      })
    );
  }

  let guard: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled(pending),
    new Promise<void>((resolve) => {
      guard = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (guard) clearTimeout(guard);

  logger.info({ grupos: keys.length }, "[channels/buffer] flush de apagado completado");
  return keys.length;
}

/** Nº de grupos pendientes. Diagnóstico y tests. */
export function pendingInboundCount(): number {
  return buffers.size;
}

/** Descarta todo sin procesar. SÓLO para tests. */
export function resetInboundBuffers(): void {
  for (const entry of buffers.values()) clearTimeout(entry.timer);
  buffers.clear();
}
