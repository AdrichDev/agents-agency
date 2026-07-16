/**
 * Dispatcher de notificaciones al dueno del negocio — aa-agent-backend-foundation
 * F6 (design.md §D, AC9, T6).
 *
 * Punto de emision unico de los avisos proactivos por evento. Los hooks ya
 * existentes lo invocan:
 *   - `crear_reserva` / `guardar_lead` (executor.ts) via `adapter.notificar`
 *     (managed-db.ts delega aqui).
 *   - `request_human_handoff` (executor.ts) lo llama directo, en paralelo al
 *     path Slack legado (que NO se toca).
 *
 * Canal v1: Telegram. Reutiliza el bot ya conectado del agente
 * (`ChannelConnection` provider="telegram") y el `sendMessage` de
 * `channels/telegram.ts` — no crea cliente nuevo. El destino es el
 * `telegramChatId` del dueno configurado en `AgentDataBackend.notificationConfig`
 * (F5).
 *
 * Invariantes:
 *   - Best-effort: un fallo o timeout de envio NUNCA lanza ni cuelga el chat /
 *     la reserva (patron `notifications.ts:13-14`). Errores → log, no throw.
 *   - Sin `telegramChatId`, evento deshabilitado o sin canal telegram → no-op
 *     silencioso (sin error).
 *   - Timeout duro sobre el envio (`AGENT_NOTIFY_TIMEOUT_MS`, def. 5000 ms).
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendMessage as tgSendMessage } from "@/lib/channels/telegram";
import { decryptCreds } from "@/lib/channels/webhook-shared";
import type { EventoNotificacion } from "./types";

const DEFAULT_TIMEOUT_MS = 5_000;

/** Shape persistido por el panel de notificaciones (F5, NotificationConfigPanel). */
interface NotificationConfigShape {
  telegramChatId?: string;
  events?: string[];
}

/**
 * Envuelve una promesa con un timeout duro. Si vence, rechaza; el llamador
 * (best-effort) captura y sigue. La promesa subyacente puede seguir viva pero
 * su resultado se descarta.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`notify timeout ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Normaliza un valor a texto no vacio, o null. */
function text(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Mensaje de aviso por evento. Espanol profesional, claro y accionable para el
 * dueno del negocio. El markdown ligero lo convierte a HTML `tgSendMessage`.
 */
export function buildNotificationMessage(
  evento: EventoNotificacion,
  payload: Record<string, unknown>
): string {
  switch (evento) {
    case "nueva_reserva": {
      const servicio = text(payload.servicio) ?? "Servicio";
      const cuando = text(payload.startTime);
      const contacto = text(payload.contacto ?? payload.nombre);
      const telefono = text(payload.telefono);
      const lineas = [`*Nueva reserva*: ${servicio}`];
      if (cuando) lineas.push(`Cuando: ${cuando}`);
      if (contacto) lineas.push(`Contacto: ${contacto}${telefono ? ` (${telefono})` : ""}`);
      else if (telefono) lineas.push(`Telefono: ${telefono}`);
      return lineas.join("\n");
    }
    case "nuevo_lead": {
      const nombre = text(payload.nombre) ?? "Sin nombre";
      const intencion = text(payload.intencion);
      const telefono = text(payload.telefono);
      const lineas = [`*Nuevo lead*: ${nombre}`];
      if (intencion) lineas.push(`Intencion: ${intencion}`);
      if (telefono) lineas.push(`Telefono: ${telefono}`);
      return lineas.join("\n");
    }
    case "handoff": {
      const resumen = text(payload.resumen);
      return resumen
        ? `*Escalado a humano* solicitado.\n${resumen}`
        : "*Escalado a humano* solicitado en una conversacion.";
    }
  }
}

/**
 * Emite un aviso al dueno del negocio por Telegram. Best-effort: nunca lanza.
 *
 * Flujo: lee `notificationConfig` del agente → si el evento esta habilitado y
 * hay `telegramChatId` → resuelve el bot del agente (ChannelConnection) → envia
 * con timeout. Cualquier condicion no cumplida = no-op silencioso.
 */
export async function dispatchNotification(
  agentId: string,
  evento: EventoNotificacion,
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    const backend = await prisma.agentDataBackend.findUnique({
      where: { agentId },
      select: { notificationConfig: true },
    });
    const cfg = (backend?.notificationConfig ?? {}) as NotificationConfigShape;

    const chatId = text(cfg.telegramChatId);
    const enabled = Array.isArray(cfg.events) && cfg.events.includes(evento);
    if (!chatId || !enabled) return; // no-op silencioso: deshabilitado o sin destino

    const numericChatId = Number(chatId);
    if (!Number.isFinite(numericChatId)) {
      logger.warn({ agentId, evento, chatId }, "[notify] chatId de telegram no numerico; aviso omitido");
      return;
    }

    const conn = await prisma.channelConnection.findUnique({
      where: { agentId_provider: { agentId, provider: "telegram" } },
      select: { credentials: true },
    });
    if (!conn) {
      logger.warn({ agentId, evento }, "[notify] agente sin canal telegram conectado; aviso omitido");
      return;
    }

    const { token } = decryptCreds<{ token: string }>(conn.credentials);
    if (!token) {
      logger.warn({ agentId, evento }, "[notify] canal telegram sin token; aviso omitido");
      return;
    }

    const message = buildNotificationMessage(evento, payload);
    const timeoutMs = Number(process.env.AGENT_NOTIFY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    await withTimeout(tgSendMessage(token, numericChatId, message), timeoutMs);
    logger.info({ agentId, evento }, "[notify] aviso telegram enviado al dueno");
  } catch (err) {
    // Best-effort: un fallo de aviso jamas rompe el chat ni la reserva.
    logger.error({ err, agentId, evento }, "[notify] fallo de aviso (best-effort, ignorado)");
  }
}
