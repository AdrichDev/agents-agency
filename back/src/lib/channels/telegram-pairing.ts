import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";

// ── Pairing por deep-link de Telegram (aa-telegram-chatid-autocaptura) ───────
//
// El token temporal vive en JSON dentro de `AgentDataBackend.notificationConfig`
// (SIN migración). Es efímero, de un solo uso y NUNCA se loguea. La comparación
// del token en el webhook es de tiempo constante para no filtrar información por
// canal lateral.

/** TTL del token de pairing (~10 min). */
export const PAIRING_TTL_MS = 10 * 60 * 1000;

/** Prefijo del deep-link de arranque en Telegram. */
export const START_PREFIX = "/start ";

/** Token de pairing persistido en notificationConfig.telegramPairing. */
export interface TelegramPairing {
  token: string;
  expiresAt: string; // ISO 8601
}

type NotifConfig = Record<string, unknown>;

/** Genera un token aleatorio criptográfico apto para URL. */
export function generatePairingToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Comparación de tiempo constante entre dos cadenas.
 * Longitudes distintas → false (sin filtrar cuál es más larga por timing).
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Lee la config, aplica una mutación superficial y persiste el objeto completo.
 * Merge superficial: no pisa claves que la mutación no toca (telegramChatId,
 * events, etc.). 404 si el agente no tiene backend de datos.
 */
async function mutateConfig(agentId: string, mutate: (cfg: NotifConfig) => void): Promise<NotifConfig> {
  const backend = await prisma.agentDataBackend.findUnique({ where: { agentId } });
  if (!backend) throw new HttpError(404, "El agente no tiene backend de datos");
  const config: NotifConfig = {
    ...(((backend.notificationConfig as NotifConfig | null) ?? {}) as NotifConfig),
  };
  mutate(config);
  const updated = await prisma.agentDataBackend.update({
    where: { agentId },
    data: { notificationConfig: config as unknown as object },
  });
  return ((updated.notificationConfig as NotifConfig | null) ?? {}) as NotifConfig;
}

/**
 * Genera y persiste un token de pairing con expiry. Merge superficial: conserva
 * telegramChatId/events. Devuelve el token para construir el deep-link (viaja
 * SOLO en el enlace al dueño autenticado).
 */
export async function setPairing(agentId: string): Promise<TelegramPairing> {
  const pairing: TelegramPairing = {
    token: generatePairingToken(),
    expiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
  };
  await mutateConfig(agentId, (cfg) => {
    cfg.telegramPairing = pairing;
  });
  return pairing;
}

/** Devuelve el pairing vigente en la config, o null si no existe/está mal formado. */
export async function getPairing(agentId: string): Promise<TelegramPairing | null> {
  const backend = await prisma.agentDataBackend.findUnique({ where: { agentId } });
  const config = (backend?.notificationConfig as NotifConfig | null) ?? null;
  const pairing = config?.telegramPairing as TelegramPairing | undefined;
  if (!pairing || typeof pairing.token !== "string" || typeof pairing.expiresAt !== "string") {
    return null;
  }
  return pairing;
}

/** Borra el pairing (single-use) conservando el resto de la config. */
export async function clearPairing(agentId: string): Promise<void> {
  await mutateConfig(agentId, (cfg) => {
    delete cfg.telegramPairing;
  });
}

/** Fija el destino de notificaciones (no toca el pairing). */
export async function setTelegramChatId(agentId: string, chatId: string): Promise<void> {
  await mutateConfig(agentId, (cfg) => {
    cfg.telegramChatId = chatId;
  });
}

/**
 * Vincula el chat del dueño de forma atómica: fija telegramChatId y BORRA el
 * pairing en una sola escritura (garantiza el single-use).
 */
export async function bindOwnerChatId(agentId: string, chatId: string): Promise<void> {
  await mutateConfig(agentId, (cfg) => {
    cfg.telegramChatId = chatId;
    delete cfg.telegramPairing;
  });
}
