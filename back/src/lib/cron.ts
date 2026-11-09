import { runAutomations } from "@/lib/automations/engine";
import { purgeExpiredConversations, type RetentionPrisma } from "@/lib/conversation-retention";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

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
