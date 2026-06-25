import { toTelegramHtml } from "@/lib/channels/format";
import { logger } from "@/lib/logger";

const TG_API = "https://api.telegram.org";

/** Resultado de getMe */
export interface TelegramBot {
  id: number;
  first_name: string;
  username: string;
}

/** Mensaje de texto dentro de un update de Telegram */
interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

/** Update entrante de Telegram */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  [key: string]: unknown;
}

/** Resultado del parseo de un update */
export interface ParsedTelegramUpdate {
  chatId: number;
  text: string | null; // null si el update no tiene texto (foto, sticker, etc.)
  updateId: number;
}

/**
 * Valida el token con getMe.
 * Lanza si la respuesta de Telegram indica error.
 */
export async function validateToken(token: string): Promise<TelegramBot> {
  const res = await fetch(`${TG_API}/bot${token}/getMe`);
  const body = (await res.json()) as { ok: boolean; result?: TelegramBot; description?: string };
  if (!body.ok || !body.result) {
    throw new Error(body.description ?? "Token de Telegram inválido");
  }
  return body.result;
}

/**
 * Registra el webhook en Telegram apuntando a la URL del backend.
 */
export async function registerWebhook(
  token: string,
  webhookUrl: string,
  secretToken: string
): Promise<void> {
  const res = await fetch(`${TG_API}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, secret_token: secretToken }),
  });
  const body = (await res.json()) as { ok: boolean; description?: string };
  if (!body.ok) {
    throw new Error(body.description ?? "Error al registrar webhook de Telegram");
  }
}

/**
 * Elimina el webhook en Telegram.
 * No lanza aunque falle (silencia el error y lo registra).
 */
export async function deleteWebhook(token: string): Promise<void> {
  try {
    await fetch(`${TG_API}/bot${token}/deleteWebhook`, { method: "POST" });
  } catch (e) {
    logger.warn({ err: e }, "[telegram] deleteWebhook falló (ignorado):");
  }
}

/**
 * Envía un mensaje de texto a un chat de Telegram.
 * Convierte el Markdown ligero del modelo a HTML (negritas reales). Si Telegram
 * rechaza el HTML, reintenta en texto plano para no perder el mensaje.
 */
export async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  const attempt = async (payload: Record<string, unknown>) => {
    const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as { ok: boolean; description?: string };
  };

  let body = await attempt({ chat_id: chatId, text: toTelegramHtml(text), parse_mode: "HTML" });
  if (!body.ok) {
    body = await attempt({ chat_id: chatId, text });
  }
  if (!body.ok) {
    throw new Error(body.description ?? "Error al enviar mensaje por Telegram");
  }
}

/**
 * Extrae chatId y texto de un update de Telegram.
 * Devuelve text=null si el update no contiene mensaje de texto (foto, sticker, etc.).
 */
export function parseTelegramUpdate(update: TelegramUpdate): ParsedTelegramUpdate | null {
  const msg = update.message ?? update.edited_message;
  if (!msg) return null;
  return {
    updateId: update.update_id,
    chatId: msg.chat.id,
    text: msg.text ?? null,
  };
}
