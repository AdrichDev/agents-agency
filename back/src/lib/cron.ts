import { runAutomations } from "@/lib/automations/engine";
import { purgeExpiredConversations, type RetentionPrisma } from "@/lib/conversation-retention";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { refreshModelCatalog } from "@/lib/llm/catalog-sources";

/**
 * Cron de automatizaciones (cada 5 min). Ejecuta runAutomations en background,
 * evitando solapamientos con un flag de ocupación. Devuelve el handle del
 * intervalo para poder pararlo en el apagado ordenado.
 */
export function startAutomationsCron(): NodeJS.Timeout {
  let cronBusy = false;
  return setInterval(async () => {
    if (cronBusy) return;
    cronBusy = true;
    try {
      const results = await runAutomations();
      if (results.length) logger.info(`[cron] ${results.length} automatizaciones: ${results.map((r) => `${r.automation}=${r.status}`).join(", ")}`);
    } catch (e) {
      logger.error({ err: e }, "[cron] error:");
    } finally {
      cronBusy = false;
    }
  }, 5 * 60 * 1000);
}

/**
 * Cada cuánto se refresca el catálogo vivo de modelos (model-catalog S1: cada 4 h).
 *
 * No más a menudo: pi.dev es una caché de models.dev que apenas cambia, el `etag` hace que la
 * mayoría de las pasadas sean un 304 sin cuerpo, y el catálogo NO es crítico (si el refresco
 * falla se sigue sirviendo la última lista buena o la estática).
 */
export const MODEL_CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Cron del catálogo de modelos. Mismo patrón que los demás (flag de ocupación + handle para el
 * apagado ordenado) con una diferencia deliberada: la PRIMERA pasada es inmediata y no bloqueante.
 *
 * Un cron de 4 h sin pasada inicial dejaría el catálogo vacío las primeras cuatro horas de cada
 * despliegue —y en un despliegue con reinicios frecuentes, siempre—. No se `await`ea: el arranque
 * no espera a pi.dev (`listen` ya está en marcha cuando esto corre), y mientras llega la respuesta
 * el endpoint sirve el respaldo estático.
 */
export function startModelCatalogCron(): NodeJS.Timeout {
  let cronBusy = false;

  const pasada = async () => {
    if (cronBusy) return;
    cronBusy = true;
    try {
      const { updated, unchanged, failed } = await refreshModelCatalog();
      // Sólo se loguea lo que cambió o falló: un 304 de los cinco proveedores cada 4 h no es
      // información, es ruido en el log de producción.
      if (updated.length || failed.length) {
        logger.info(
          { updated, unchanged, failed },
          "[cron] catálogo de modelos refrescado"
        );
      }
    } catch (e) {
      // `refreshModelCatalog` no lanza (cada proveedor va en su propio try); esto es la red por si
      // un día deja de serlo: el cron no puede tumbar el proceso.
      logger.error({ err: e }, "[cron] catálogo de modelos error:");
    } finally {
      cronBusy = false;
    }
  };

  void pasada();
  return setInterval(() => void pasada(), MODEL_CATALOG_REFRESH_INTERVAL_MS);
}

/**
 * Cada cuánto se pasa la purga por retención (S3, conversation-persistence).
 *
 * Diario, no cada 5 minutos: la retención se mide en días y cada pasada es un `findMany` sobre el
 * índice de `updatedAt` más como mucho un puñado de `deleteMany`. Correrla más a menudo no borra
 * nada antes —el corte es el mismo— y sí multiplica el trabajo.
 */
export const RETENTION_CRON_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Cron de retención de conversaciones. Mismo patrón que el de automatizaciones (flag de ocupación
 * + handle para el apagado ordenado) y el mismo kill-switch `ENABLE_CRONS` en `index.ts`.
 *
 * El cast es el puente hasta que se regenere el cliente: `Conversation.updatedAt` está en el
 * schema y en la migración, pero `src/lib/generated/prisma` todavía no lo conoce. Con
 * `npx prisma generate` el cast se puede quitar; no cambia ninguna comprobación en ejecución.
 */
export function startConversationRetentionCron(
  db: RetentionPrisma = prisma as unknown as RetentionPrisma
): NodeJS.Timeout {
  let cronBusy = false;
  return setInterval(async () => {
    if (cronBusy) return;
    cronBusy = true;
    try {
      const { deleted, chunks } = await purgeExpiredConversations(db);
      if (chunks) logger.info(`[cron] retención: ${deleted} conversaciones en ${chunks} lote(s)`);
    } catch (e) {
      // Un fallo de la purga no puede tumbar el proceso ni dejar el flag tomado: se registra y la
      // siguiente pasada lo reintenta.
      logger.error({ err: e }, "[cron] retención error:");
    } finally {
      cronBusy = false;
    }
  }, RETENTION_CRON_INTERVAL_MS);
}
