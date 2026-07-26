import { Request, Response } from "express";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { wasProcessed, markProcessed } from "@/lib/channels/dedup";
import {
  verifyWebhookChallenge,
  validateHmacSignature,
  parseWhatsAppEvent,
  sendMessage as waSendMessage,
  type WhatsAppWebhookPayload,
  type WhatsAppCredentials,
} from "@/lib/channels/whatsapp";
import { chatWithAgent } from "@/lib/agent/engine";
import {
  decryptCreds,
  resolveConversation,
  mergeConversationMetadata,
  channelErrorMessage,
} from "@/lib/channels/webhook-shared";

// ── GET /api/channels/whatsapp/:agentId (verificación Meta) ─────────────────

export async function handleWhatsAppVerify(req: Request, res: Response) {
  const { agentId } = req.params;

  const conn = await prisma.channelConnection.findUnique({
    where: { agentId_provider: { agentId, provider: "whatsapp" } },
  });
  if (!conn) return res.status(404).json({ error: "No encontrado" });

  let creds: WhatsAppCredentials;
  try {
    creds = decryptCreds<WhatsAppCredentials>(conn.credentials);
  } catch {
    return res.status(500).json({ error: "Error interno" });
  }

  const query = req.query as Record<string, string | undefined>;
  const challenge = verifyWebhookChallenge(query, creds.verifyToken);

  if (!challenge) {
    return res.status(403).send("Forbidden");
  }

  // Activar conexión
  await prisma.channelConnection
    .update({
      where: { agentId_provider: { agentId, provider: "whatsapp" } },
      data: { status: "active" },
    })
    .catch(() => {});

  // Responder con el challenge en texto plano (requerido por Meta)
  res.setHeader("Content-Type", "text/plain");
  return res.status(200).send(challenge);
}

// ── POST /api/channels/whatsapp/:agentId (webhook receptor) ─────────────────

export async function handleWhatsAppWebhook(req: Request, res: Response) {
  const { agentId } = req.params;

  // Verificación obligatoria de la firma HMAC del webhook (fail-closed):
  // sin secreto configurado, sin rawBody o con firma inválida → se rechaza.
  // META_APP_SECRET es requisito operativo del canal WhatsApp.
  const appSecret = process.env.META_APP_SECRET;
  const rawBody: Buffer | undefined = req.rawBody;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  if (!appSecret) {
    logger.warn("[channels/whatsapp] META_APP_SECRET no configurado; webhook rechazado (fail-closed)");
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!rawBody || !validateHmacSignature(rawBody, signature, appSecret)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const conn = await prisma.channelConnection.findUnique({
    where: { agentId_provider: { agentId, provider: "whatsapp" } },
  });
  if (!conn) return res.status(404).json({ error: "No encontrado" });

  const payload = req.body as WhatsAppWebhookPayload;
  const parsed = parseWhatsAppEvent(payload);

  if (!parsed) {
    // Evento de status o estructura desconocida — ignorar
    return res.json({ ok: true });
  }

  // Dedup por message id
  const dedupKey = `wa:${agentId}:${parsed.messageId}`;
  if (wasProcessed(dedupKey)) {
    return res.json({ ok: true });
  }

  let creds: WhatsAppCredentials;
  try {
    creds = decryptCreds<WhatsAppCredentials>(conn.credentials);
  } catch {
    return res.status(500).json({ error: "Error interno" });
  }

  // Sin texto → mensaje de cortesía
  if (!parsed.text) {
    await waSendMessage(
      creds.phoneNumberId,
      creds.accessToken,
      parsed.from,
      "Lo siento, en este momento solo puedo responder a mensajes de texto."
    ).catch(() => {});
    markProcessed(dedupKey);
    return res.json({ ok: true });
  }

  // Resolver conversación
  const conversationId = await resolveConversation(agentId, "whatsapp", parsed.from, {});

  let reply: { conversationId: string; text: string };
  try {
    reply = await chatWithAgent(agentId, parsed.text, conversationId, "whatsapp");
  } catch (e) {
    logger.error({ err: e }, "[channels/whatsapp] chatWithAgent error:");
    await waSendMessage(
      creds.phoneNumberId,
      creds.accessToken,
      parsed.from,
      channelErrorMessage(e)
    ).catch(() => {});
    // 200 siempre: Meta reintenta el webhook ante status de error, y un corte por cupo no
    // se resuelve reintentando.
    return res.json({ ok: true });
  }

  // Fijar metadata.externalId (merge — no pisar leadFlow, ver webhook de Telegram)
  if (reply.conversationId) {
    await mergeConversationMetadata(reply.conversationId, {
      externalId: parsed.from,
      waFrom: parsed.from,
    });
  }

  // Enviar respuesta
  await waSendMessage(
    creds.phoneNumberId,
    creds.accessToken,
    parsed.from,
    reply.text
  ).catch((e) => {
    logger.error({ err: e }, "[channels/whatsapp] sendMessage error:");
  });

  markProcessed(dedupKey);
  return res.json({ ok: true });
}
