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
 * Botón de un teclado inline de Telegram. `callback_data` viaja de vuelta al
 * agente cuando el humano pulsa el botón (límite duro de Telegram: 64 bytes).
 */
export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

/** Teclado inline (reply_markup) de Telegram. */
export interface TelegramReplyMarkup {
  inline_keyboard: TelegramInlineButton[][];
}

/** Opciones opcionales de sendMessage. Sin ellas el comportamiento es el de siempre. */
export interface TelegramSendOptions {
  replyMarkup?: TelegramReplyMarkup;
}

/** Opciones opcionales de editMessageText. */
export interface TelegramEditOptions {
  replyMarkup?: TelegramReplyMarkup;
}

/**
 * Envía un mensaje de texto a un chat de Telegram.
 * Convierte el Markdown ligero del modelo a HTML (negritas reales). Si Telegram
 * rechaza el HTML, reintenta en texto plano para no perder el mensaje.
 *
 * `opciones.replyMarkup` (S14) añade botones inline Confirmar/Cancelar; es
 * OPCIONAL para no tocar a ningún llamador existente.
 *
 * Devuelve el `message_id` del mensaje enviado (lo necesita el progreso S15:
 * editar EXACTAMENTE ese mensaje) o `null` si Telegram no lo manda. El payload
 * enviado no cambia por devolverlo: los llamadores existentes siguen intactos.
 */
export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  opciones?: TelegramSendOptions
): Promise<number | null> {
  const attempt = async (payload: Record<string, unknown>) => {
    const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as {
      ok: boolean;
      description?: string;
      result?: { message_id?: number };
    };
  };

  // El teclado se conserva en el reintento: si el HTML falla, el humano tiene
  // que seguir pudiendo confirmar o cancelar.
  const markup = opciones?.replyMarkup ? { reply_markup: opciones.replyMarkup } : {};
  let body = await attempt({ chat_id: chatId, text: toTelegramHtml(text), parse_mode: "HTML", ...markup });
  if (!body.ok) {
    body = await attempt({ chat_id: chatId, text, ...markup });
  }
  if (!body.ok) {
    throw new Error(body.description ?? "Error al enviar mensaje por Telegram");
  }
  return typeof body.result?.message_id === "number" ? body.result.message_id : null;
}

/** Límite de espera de cada edición de mensaje (S15). */
export const EDIT_TIMEOUT_MS = 5000;

/** Telegram responde esto cuando el texto ya es el mismo: no es un fallo real. */
function esMensajeSinCambios(description?: string) {
  return typeof description === "string" && description.toLowerCase().includes("message is not modified");
}

/**
 * Reescribe un mensaje ya enviado (S15): el mensaje de los botones pasa a
 * "⏳ Creando contacto…", a los puntos en movimiento y al resultado final.
 *
 * Sin `opciones.replyMarkup` el teclado inline DESAPARECE: Telegram sólo lo
 * quita si se manda un teclado inline VACÍO, así que omitir el campo dejaría los
 * botones Confirmar/Cancelar a la vista después de usarlos.
 *
 * Mismo criterio que sendMessage: HTML primero y texto plano si Telegram lo
 * rechaza; "message is not modified" no es un error. Lanza sólo si el fallo es
 * real: quien llama decide si eso importa (el progreso nunca rompe la acción).
 */
export async function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  opciones?: TelegramEditOptions
): Promise<void> {
  const attempt = async (payload: Record<string, unknown>) => {
    // Tope de 5 s: una API de Telegram colgada no debe retrasar la confirmación
    // ni la escritura (el progreso es cosmético; quien llama ya tolera el fallo).
    const res = await fetch(`${TG_API}/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(EDIT_TIMEOUT_MS),
    });
    return (await res.json()) as { ok: boolean; description?: string };
  };

  const base = {
    chat_id: chatId,
    message_id: messageId,
    // Teclado inline vacío = se quitan los botones del mensaje.
    reply_markup: opciones?.replyMarkup ?? { inline_keyboard: [] },
  };
  let body = await attempt({ ...base, text: toTelegramHtml(text), parse_mode: "HTML" });
  if (!body.ok && !esMensajeSinCambios(body.description)) {
    body = await attempt({ ...base, text });
  }
  if (!body.ok && !esMensajeSinCambios(body.description)) {
    throw new Error(body.description ?? "Error al editar el mensaje de Telegram");
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
