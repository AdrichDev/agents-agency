/**
 * S3 (conversation-persistence) — retención y purga de conversaciones del WIDGET.
 *
 * Qué resuelve: el transcript se guarda entero (2 `createMany` por turno) y hasta esta tarea no
 * se borraba nunca. La retención acota ese crecimiento sin romper la promesa del "transcript
 * completo": se guarda todo mientras la conversación es reciente, y se purga cuando deja de serlo.
 *
 * El RIESGO de esta pieza es el borrado masivo, y el diseño entero está subordinado a él:
 *
 *  - **Un canal de mensajería no se purga NUNCA.** El hilo de Telegram/WhatsApp/openclaw es de
 *    por vida del contacto: borrarlo no se puede reconstruir y el contacto no puede volver a
 *    empezar. Por eso el filtro de canal vive en DOS sitios —la lectura de candidatas (`where`
 *    con `OR: [{channel:'widget'},{channel:null}]`) y el `deleteMany`— y el plan puro vuelve a
 *    aplicarlo con `usesExpiringSession`, la misma función que decide la caducidad de sesión.
 *  - **El borrado va por ids planificados, no por fecha.** Un `deleteMany({ where: { updatedAt:
 *    { lt: cutoff } } })` es la forma corta y es la equivocada: se lleva por delante cualquier
 *    fila que encaje en la fecha, incluidos hilos de canal si algún día cambia el default de
 *    `channel`. Aquí se borra exactamente lo que el plan dice, en lotes de 500 ids.
 *  - **La purga nunca decide con el reloj de otro.** `now` se inyecta para que el borde sea
 *    determinista en las pruebas.
 *
 * El "cerrada" y el "sin canal" se leen de `conversation-session.ts` (`isConversationSessionClosed`,
 * `usesExpiringSession`) para que purga y sesión no puedan aplicar reglas distintas.
 */
import { logger } from "@/lib/logger";
import {
  isConversationSessionClosed,
  usesExpiringSession,
  type ConversationSessionLike,
} from "@/lib/agent/conversation-session";

/** Días de retención por defecto (`CONVERSATION_RETENTION_DAYS`). */
export const DEFAULT_RETENTION_DAYS = 30;

/** Canales que la purga SÍ puede tocar. Un canal de mensajería no entra aquí jamás. */
export const PURGEABLE_CHANNEL = "widget";

/** Tamaño de lote del `deleteMany`. Acota el `IN (...)` y el tiempo de la transacción implícita. */
export const PURGE_CHUNK_SIZE = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Interpreta `CONVERSATION_RETENTION_DAYS`. Pura: devuelve `invalid` para que el llamador avise
 * una sola vez en el log y las pruebas comprueben la interpretación sin tocar el entorno.
 */
export function resolveRetentionDays(raw: string | undefined): {
  days: number;
  invalid: boolean;
} {
  const texto = (raw ?? "").trim();
  if (!texto) return { days: DEFAULT_RETENTION_DAYS, invalid: false };
  const dias = Number(texto);
  if (!Number.isFinite(dias) || dias <= 0) {
    return { days: DEFAULT_RETENTION_DAYS, invalid: true };
  }
  return { days: dias, invalid: false };
}

/** Retención en vigor, leída UNA vez al cargar el módulo. */
export const RETENTION_DAYS: number = (() => {
  const { days, invalid } = resolveRetentionDays(process.env.CONVERSATION_RETENTION_DAYS);
  if (invalid) {
    logger.warn(
      { raw: process.env.CONVERSATION_RETENTION_DAYS },
      `[conversation-retention] CONVERSATION_RETENTION_DAYS inválido; se usa ${DEFAULT_RETENTION_DAYS} días`
    );
  }
  return days;
})();

/**
 * Instante a partir del cual una conversación es "vieja". Función pura: no lee el reloj.
 * El borde es estricto (`< cutoff` purga, `=== cutoff` aún no): la retención se resuelve hacia el
 * lado conservador, que es conservar la fila un instante más.
 */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Lo mínimo que necesita la purga de una fila `Conversation`. */
export interface RetentionCandidate extends ConversationSessionLike {
  id: string;
}

/** Última actividad: `updatedAt` y, mientras la migración no esté aplicada, `createdAt`. */
function lastActivityAt(conversation: ConversationSessionLike): Date | null {
  const raw = conversation.updatedAt ?? conversation.createdAt ?? null;
  if (!raw) return null;
  const fecha = raw instanceof Date ? raw : new Date(raw);
  const ms = fecha.getTime();
  return Number.isFinite(ms) ? fecha : null;
}

/**
 * Filtro de canal en la forma que espera SQL. Es el MISMO criterio que `usesExpiringSession`
 * (widget + filas antiguas sin canal), y hay una prueba que lo recorre canal a canal para que no
 * puedan divergir. Se construye nuevo en cada llamada para no compartir objeto mutable.
 */
function channelScope(): { OR: Array<{ channel: string | null }> } {
  return { OR: [{ channel: PURGEABLE_CHANNEL }, { channel: null }] };
}

/**
 * Decide, SIN tocar la BD, qué conversaciones se borran.
 *
 * Purga una conversación cuando es del widget (o sin canal) y además:
 *  - el visitante cerró la sesión (`metadata.session.closedAt`), o
 *  - su última actividad es anterior al corte de retención.
 *
 * Una fila sin actividad registrada no se purga: no se puede afirmar que haya caducado.
 */
export function planWidgetPurge(
  conversations: readonly RetentionCandidate[],
  cutoff: Date
): string[] {
  const corte = cutoff.getTime();
  return conversations
    .filter((conversation) => usesExpiringSession(conversation.channel))
    .filter((conversation) => {
      if (isConversationSessionClosed(conversation)) return true;
      const ultima = lastActivityAt(conversation);
      return ultima !== null && ultima.getTime() < corte;
    })
    .map((conversation) => conversation.id);
}

// ── Runner ───────────────────────────────────────────────────────────────────

/** `where` de la purga, en forma estructural (el cliente generado aún no conoce `updatedAt`). */
export type RetentionWhere = {
  id?: { in: string[] };
  updatedAt?: { lt: Date };
  OR?: Array<{ channel: string | null }>;
};

/**
 * Lo que la purga necesita del cliente Prisma. Estructural a propósito: el cliente generado se
 * regenerará con `updatedAt` (`prisma generate`), y mientras tanto esta forma mínima evita que la
 * lógica dependa de los tipos generados.
 */
export interface RetentionPrisma {
  conversation: {
    findMany(args: {
      where: RetentionWhere;
      select: { id: true; channel: true; metadata: true; updatedAt: true };
    }): Promise<RetentionCandidate[]>;
    deleteMany(args: { where: RetentionWhere }): Promise<{ count: number }>;
  };
}

/**
 * Lee candidatas, planifica y borra en lotes de `PURGE_CHUNK_SIZE` ids.
 *
 * La lectura usa el índice nuevo: `updatedAt < cutoff` + canal acotado, así que un hilo de
 * Telegram/WhatsApp no entra ni siquiera en el conjunto de candidatas (el `OR` de canal es el
 * mismo en la lectura y en el borrado).
 *
 * Ojo deliberado: la lectura se acota por `updatedAt`, no por "cerrada". Una conversación cerrada
 * hace diez minutos no entra en el lote — sigue dentro de la retención y el visitante puede
 * volver a empezar sin problema. El cierre sólo decide dentro del plan, para el día en que la
 * conversación cruce además la línea de inactividad. Lo que acota la tabla es la retención.
 *
 * @returns cuántas filas borró la BD (no cuántas se pidieron) y cuántos lotes hizo falta.
 */
export async function purgeExpiredConversations(
  prisma: RetentionPrisma,
  options: { now?: Date; retentionDays?: number } = {}
): Promise<{ deleted: number; chunks: number }> {
  const now = options.now ?? new Date();
  const days = options.retentionDays ?? RETENTION_DAYS;
  const cutoff = retentionCutoff(now, days);

  const candidates = await prisma.conversation.findMany({
    where: { updatedAt: { lt: cutoff }, ...channelScope() },
    select: { id: true, channel: true, metadata: true, updatedAt: true },
  });

  const ids = planWidgetPurge(candidates, cutoff);

  let deleted = 0;
  let chunks = 0;
  for (let i = 0; i < ids.length; i += PURGE_CHUNK_SIZE) {
    const batch = ids.slice(i, i + PURGE_CHUNK_SIZE);
    // El `OR` de canal NO es decorativo: si algún día el plan se equivoca, el borrado sigue sin
    // poder tocar un hilo de mensajería.
    const { count } = await prisma.conversation.deleteMany({
      where: { id: { in: batch }, ...channelScope() },
    });
    deleted += count;
    chunks += 1;
  }

  if (chunks > 0) {
    logger.info(
      { deleted, chunks, retentionDays: days },
      `[conversation-retention] ${deleted} conversaciones purgadas en ${chunks} lote(s)`
    );
  }

  return { deleted, chunks };
}
