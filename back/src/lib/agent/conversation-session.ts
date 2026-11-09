/**
 * S1 / S2 (conversation-persistence) — semántica de la sesión del VISITANTE del widget.
 *
 * Única fuente de verdad de cuándo una conversación se puede reanudar. La consumen el motor
 * (`chatWithAgent`, al retomar un `conversationId`) y la ruta pública de cierre
 * (`POST /api/chat/session-end`), para que las dos no puedan discrepar.
 *
 * Decisiones:
 *  - **Caducidad por inactividad.** La última actividad es `updatedAt ?? createdAt`: `updatedAt`
 *    lo añade la retención (T2) y lo refresca cada turno, pero hasta que esa migración exista la
 *    fila sólo tiene `createdAt`, así que el fallback es obligatorio, no una comodidad.
 *  - **El límite es inclusivo.** A las 24 h exactas de inactividad la conversación ya caducó. El
 *    borde se resuelve hacia el lado seguro (privacidad: no reanudar) y así una conversación
 *    nunca queda en un estado ambiguo de "justo en el TTL" que dependa de milisegundos.
 *  - **Sólo el widget caduca.** Telegram, WhatsApp y openclaw atienden a un contacto por un hilo
 *    que es de por vida: cerrar o caducar ahí rompería el canal. El filtro por canal vive en una
 *    sola función (`usesExpiringSession`) para que motor y ruta no puedan aplicarlo distinto.
 *  - **El cierre es un dato de metadata**, `metadata.session.closedAt`, escrito con
 *    `mergeConversationMetadata` (spread no destructivo): `leadFlow`, `handoff` y lo que escriban
 *    las herramientas durante el turno sobreviven.
 */
import { logger } from "@/lib/logger";

/** Horas de inactividad tras las cuales la sesión del widget caduca. */
export const DEFAULT_SESSION_TTL_HOURS = 24;

/** Código de error del 410. El widget lo usa para saber que debe empezar de cero. */
export const CONVERSATION_EXPIRED_CODE = "CONVERSATION_EXPIRED" as const;

/** Mensaje para la conversación cerrada por el visitante (lever para el operador en los logs). */
export const SESSION_CLOSED_MESSAGE = "La conversación ya se cerró.";

/** Mensaje para la conversación caducada por inactividad. */
export const SESSION_EXPIRED_MESSAGE = "La conversación ha caducado por inactividad.";

/**
 * Lo mínimo que necesita la semántica de sesión de una fila `Conversation`.
 * `createdAt` puede faltar en objetos construidos a mano (tests, canales) y entonces no se puede
 * afirmar caducidad: mejor no reanudar de más que cerrar una conversación viva.
 */
export interface ConversationSessionLike {
  metadata?: unknown;
  channel?: string | null;
  updatedAt?: Date | null;
  createdAt?: Date | null;
}

export type SessionEndGuardResult =
  | { ok: true }
  | {
      ok: false;
      status: 410;
      code: typeof CONVERSATION_EXPIRED_CODE;
      message: string;
    };

// ── TTL ──────────────────────────────────────────────────────────────────────

/**
 * Interpreta `CONVERSATION_SESSION_TTL_HOURS`. Función pura: `invalid` deja que el llamador avise
 * en el log una sola vez, y los tests puedan comprobar la interpretación sin tocar el entorno.
 */
export function resolveSessionTtlHours(raw: string | undefined): {
  hours: number;
  invalid: boolean;
} {
  const texto = (raw ?? "").trim();
  if (!texto) return { hours: DEFAULT_SESSION_TTL_HOURS, invalid: false };
  const horas = Number(texto);
  if (!Number.isFinite(horas) || horas <= 0) {
    return { hours: DEFAULT_SESSION_TTL_HOURS, invalid: true };
  }
  return { hours: horas, invalid: false };
}

/**
 * TTL en vigor, leído UNA vez al cargar el módulo. Un valor inválido cae al default con un aviso
 * (una sola vez por proceso: no tiene sentido escribir una línea por mensaje del widget).
 */
export const SESSION_TTL_HOURS: number = (() => {
  const { hours, invalid } = resolveSessionTtlHours(process.env.CONVERSATION_SESSION_TTL_HOURS);
  if (invalid) {
    logger.warn(
      { raw: process.env.CONVERSATION_SESSION_TTL_HOURS },
      `[conversation-session] CONVERSATION_SESSION_TTL_HOURS inválido; se usa ${DEFAULT_SESSION_TTL_HOURS} h`
    );
  }
  return hours;
})();

// ── Canal ────────────────────────────────────────────────────────────────────

/**
 * ¿La conversación pertenece a un canal cuya sesión caduca? Sólo el widget (y las filas sin canal,
 * anteriores a que el canal se persistiera). Un `telegram`/`whatsapp`/`openclaw` nunca caduca.
 */
export function usesExpiringSession(channel: string | null | undefined): boolean {
  return !channel || channel === "widget";
}

// ── Estado de la sesión ──────────────────────────────────────────────────────

/**
 * ¿El visitante cerró la sesión explícitamente? La marca es `metadata.session.closedAt`.
 * La presencia de una cadena no vacía es el criterio: el valor es informativo (auditoría), no se
 * repara ni se compara contra nada.
 */
export function isConversationSessionClosed(conversation: { metadata?: unknown }): boolean {
  const meta = conversation.metadata;
  if (!meta || typeof meta !== "object") return false;
  const session = (meta as { session?: unknown }).session;
  if (!session || typeof session !== "object") return false;
  const closedAt = (session as { closedAt?: unknown }).closedAt;
  return typeof closedAt === "string" && closedAt.length > 0;
}

/**
 * ¿Ha pasado más de un TTL desde la última actividad? `now` se inyecta para que el borde sea
 * determinista en los tests (nunca se lee el reloj aquí).
 */
export function isConversationSessionExpired(
  conversation: ConversationSessionLike,
  now: Date = new Date()
): boolean {
  const ultima = conversation.updatedAt ?? conversation.createdAt ?? null;
  if (!ultima) return false; // sin actividad registrada no se puede afirmar caducidad
  const ultimaMs = ultima instanceof Date ? ultima.getTime() : new Date(ultima).getTime();
  if (!Number.isFinite(ultimaMs)) return false;
  return now.getTime() - ultimaMs >= SESSION_TTL_HOURS * 60 * 60 * 1000;
}

/**
 * Guardián único de la sesión: lo usan el motor (al reanudar) y la ruta de cierre.
 *
 * Devuelve `{ ok: true }` cuando la conversación se puede seguir usando (incluido siempre un canal
 * sin caducidad) o el 410 que ambos llamadores tienen que propagar tal cual.
 */
export function sessionEndGuard(
  conversation: ConversationSessionLike,
  now: Date = new Date()
): SessionEndGuardResult {
  // Un canal de mensajería no caduca ni se cierra por la señal del widget.
  if (!usesExpiringSession(conversation.channel)) return { ok: true };

  if (isConversationSessionClosed(conversation)) {
    return {
      ok: false,
      status: 410,
      code: CONVERSATION_EXPIRED_CODE,
      message: SESSION_CLOSED_MESSAGE,
    };
  }

  if (isConversationSessionExpired(conversation, now)) {
    return {
      ok: false,
      status: 410,
      code: CONVERSATION_EXPIRED_CODE,
      message: SESSION_EXPIRED_MESSAGE,
    };
  }

  return { ok: true };
}
