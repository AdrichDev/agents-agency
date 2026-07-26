import { Request, Response } from "express";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { wasProcessed, markProcessed } from "@/lib/channels/dedup";
import {
  sendMessage as tgSendMessage,
  parseTelegramUpdate,
  type TelegramUpdate,
} from "@/lib/channels/telegram";
import { chatWithAgent } from "@/lib/agent/engine";
import {
  getPairing,
  bindOwnerChatId,
  timingSafeEqualStr,
  START_PREFIX,
} from "@/lib/channels/telegram-pairing";
import {
  decryptCreds,
  resolveConversation,
  mergeConversationMetadata,
  channelErrorMessage,
} from "@/lib/channels/webhook-shared";
import { fanOutTelegramToCrm } from "@/lib/channels/crm-telegram-fanout";

// ── POST /api/channels/telegram/:agentId (webhook receptor) ─────────────────

export async function handleTelegramWebhook(req: Request, res: Response) {
  const { agentId } = req.params;

  const conn = await prisma.channelConnection.findUnique({
    where: { agentId_provider: { agentId, provider: "telegram" } },
  });
  if (!conn) return res.status(404).json({ error: "No encontrado" });

  // Validar secret token
  const incomingSecret = req.headers["x-telegram-bot-api-secret-token"] as string | undefined;
  if (!incomingSecret || incomingSecret !== conn.webhookSecret) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const update = req.body as TelegramUpdate;
  const parsed = parseTelegramUpdate(update);

  if (!parsed) {
    // Update sin message — ignorar silenciosamente
    return res.json({ ok: true });
  }

  // Dedup por update_id
  const dedupKey = `tg:${agentId}:${parsed.updateId}`;
  if (wasProcessed(dedupKey)) {
    return res.json({ ok: true });
  }

  let creds: { token: string };
  try {
    creds = decryptCreds<{ token: string }>(conn.credentials);
  } catch {
    return res.status(500).json({ error: "Error interno" });
  }

  // Sin texto → mensaje de cortesía
  if (!parsed.text) {
    await tgSendMessage(
      creds.token,
      parsed.chatId,
      "Lo siento, solo puedo responder a mensajes de texto."
    ).catch(() => {});
  markProcessed(dedupKey);
    return res.json({ ok: true });
  }

  // F3 (aa-telegram-chatid-autocaptura): pairing por deep-link. Si el texto es
  // "/start <token>", intentamos vincular el chat del dueño como destino de
  // notificaciones y NO pasamos el mensaje al LLM. El token es la prueba de
  // autorización (análogo al webhookSecret); nunca se loguea. Un "/start" pelado
  // o un mensaje normal siguen el flujo actual (saludo/LLM).
  if (parsed.text.startsWith(START_PREFIX)) {
    const token = parsed.text.slice(START_PREFIX.length).trim();
    const pairing = await getPairing(agentId);
    const valid =
      Boolean(pairing) &&
      token.length > 0 &&
      timingSafeEqualStr(token, pairing!.token) &&
      new Date(pairing!.expiresAt).getTime() > Date.now();

    if (valid) {
      // Merge atómico: fija telegramChatId y borra el pairing (single-use).
      await bindOwnerChatId(agentId, String(parsed.chatId));
      await tgSendMessage(
        creds.token,
        parsed.chatId,
        "✅ Listo. Aquí recibirás las notificaciones del negocio."
      ).catch(() => {});
    } else {
      // Mensaje neutro: no filtramos si el token no existe, expiró o ya se usó.
      await tgSendMessage(
        creds.token,
        parsed.chatId,
        "Este enlace de vinculación no es válido o expiró."
      ).catch(() => {});
    }
    markProcessed(dedupKey);
    return res.json({ ok: true });
  }

  // Resolver conversación
  const externalId = String(parsed.chatId);
  const conversationId = await resolveConversation(agentId, "telegram", externalId, {});

  // Llamar pipeline de chat
  let reply: { conversationId: string; text: string };
  try {
    reply = await chatWithAgent(agentId, parsed.text, conversationId, "telegram");
  } catch (e) {
    logger.error({ err: e }, "[channels/telegram] chatWithAgent error:");
    await tgSendMessage(creds.token, parsed.chatId, channelErrorMessage(e)).catch(() => {});
    // 200 siempre: un status de error haría que Telegram reintentase el update en bucle,
    // y un corte por cupo no se resuelve reintentando.
    return res.json({ ok: true });
  }

  // Fijar metadata.externalId en la conversación (para búsquedas futuras).
  // MERGE con el metadata existente: chatWithAgent guarda ahí leadFlow y
  // sobrescribirlo reiniciaría el flujo de captación en cada mensaje.
  if (reply.conversationId) {
    await mergeConversationMetadata(reply.conversationId, {
      externalId,
      telegramChatId: parsed.chatId,
    });
  }

  const agent = typeof (prisma as any).agent?.findUnique === "function"
    ? await (prisma as any).agent.findUnique({ where: { id: agentId }, select: { tenantId: true } })
    : null;
  await fanOutTelegramToCrm({
    businessId: agent?.tenantId,
    conversationId: reply.conversationId,
    direction: "in",
    text: parsed.text,
    providerMessageId: `tg-update-${parsed.updateId}`,
    remitente: externalId,
  });

  // Responder al usuario
  await tgSendMessage(creds.token, parsed.chatId, reply.text).catch((e) => {
    logger.error({ err: e }, "[channels/telegram] sendMessage error:");
  });

  await fanOutTelegramToCrm({
    businessId: agent?.tenantId,
    conversationId: reply.conversationId,
    direction: "out",
    text: reply.text,
    clientMessageId: `aa-auto-${parsed.updateId}`,
  });

  markProcessed(dedupKey);
  return res.json({ ok: true });
}
