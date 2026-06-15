import { Router, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { encrypt, decrypt, type EncryptedPayload } from "@/lib/crypto";
import { wasProcessed, markProcessed } from "@/lib/channels/dedup";
import {
  validateToken,
  registerWebhook,
  deleteWebhook as tgDeleteWebhook,
  sendMessage as tgSendMessage,
  parseTelegramUpdate,
  type TelegramUpdate,
} from "@/lib/channels/telegram";
import {
  verifyWebhookChallenge,
  validateHmacSignature,
  parseWhatsAppEvent,
  sendMessage as waSendMessage,
  type WhatsAppWebhookPayload,
  type WhatsAppCredentials,
} from "@/lib/channels/whatsapp";
import { chatWithAgent } from "@/lib/agent/engine";

export const channelsRouter = Router();

const PUBLIC_URL = () => process.env.PUBLIC_URL?.replace(/\/$/, "");

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Cifra un objeto de credenciales. Lanza HTTP 500 si falta CHANNEL_ENCRYPTION_KEY. */
function encryptCreds(creds: object): EncryptedPayload {
  return encrypt(JSON.stringify(creds));
}

/** Descifra credenciales almacenadas. */
function decryptCreds<T>(raw: unknown): T {
  return JSON.parse(decrypt(raw as EncryptedPayload)) as T;
}

/**
 * Busca o crea una Conversation vinculada a un chat externo.
 * Usa metadata.externalId como clave canónica de búsqueda.
 */
async function resolveConversation(
  agentId: string,
  channel: string,
  externalId: string,
  _extraMeta: Record<string, unknown>
): Promise<string | undefined> {
  const existing = await prisma.conversation.findFirst({
    where: {
      agentId,
      channel,
      metadata: { path: ["externalId"], equals: externalId },
    },
    orderBy: { createdAt: "desc" },
  });
  // Si no hay conversación previa, devuelve undefined para que chatWithAgent cree una nueva.
  return existing?.id;
}

/**
 * Mezcla claves en Conversation.metadata sin pisar las existentes (p. ej. leadFlow,
 * que chatWithAgent persiste en cada turno). Best-effort: nunca rompe la respuesta.
 */
async function mergeConversationMetadata(
  conversationId: string,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { metadata: true },
    });
    const current = (conversation?.metadata as Record<string, unknown>) ?? {};
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { metadata: JSON.parse(JSON.stringify({ ...current, ...patch })) },
    });
  } catch {
    // best-effort
  }
}

// ── POST /api/channels/:provider/connect ────────────────────────────────────

channelsRouter.post("/:provider/connect", async (req: Request, res: Response) => {
  const { provider } = req.params;
  if (provider !== "telegram" && provider !== "whatsapp") {
    return res.status(400).json({ error: "Proveedor desconocido" });
  }

  // Verificar cifrado disponible
  try {
    encrypt("test");
  } catch {
    return res.status(500).json({ error: "Configuración de cifrado incompleta" });
  }

  if (provider === "telegram") {
    const publicUrl = PUBLIC_URL();
    if (!publicUrl) {
      return res.status(503).json({
        error: "PUBLIC_URL no configurada; el backend no es accesible públicamente",
      });
    }

    const { agentId, token } = req.body ?? {};
    if (!agentId || !token) {
      return res.status(400).json({ error: "agentId y token son requeridos" });
    }

    // Validar token con getMe
    let botInfo: { first_name: string; username: string };
    try {
      botInfo = await validateToken(token);
    } catch (e) {
      // Guardar intento fallido
      try {
        await prisma.channelConnection.upsert({
          where: { agentId_provider: { agentId, provider: "telegram" } },
          create: {
            agentId,
            provider: "telegram",
            credentials: encryptCreds({ token }) as unknown as object,
            status: "error",
            statusDetail: e instanceof Error ? e.message : "Token inválido",
          },
          update: {
            credentials: encryptCreds({ token }) as unknown as object,
            status: "error",
            statusDetail: e instanceof Error ? e.message : "Token inválido",
          },
        });
      } catch {}
      return res.status(422).json({ error: "Token de Telegram inválido" });
    }

    // Generar webhookSecret y registrar webhook
    const webhookSecret = randomBytes(32).toString("hex");
    const webhookUrl = `${publicUrl}/api/channels/telegram/${agentId}`;

    try {
      await registerWebhook(token, webhookUrl, webhookSecret);
    } catch (e) {
      return res.status(502).json({ error: "Error al registrar webhook en Telegram" });
    }

    // Upsert connection
    try {
      await prisma.channelConnection.upsert({
        where: { agentId_provider: { agentId, provider: "telegram" } },
        create: {
          agentId,
          provider: "telegram",
          credentials: encryptCreds({ token }) as unknown as object,
          status: "active",
          webhookSecret,
          botUsername: botInfo.username,
          botName: botInfo.first_name,
        },
        update: {
          credentials: encryptCreds({ token }) as unknown as object,
          status: "active",
          webhookSecret,
          botUsername: botInfo.username,
          botName: botInfo.first_name,
          statusDetail: null,
        },
      });
    } catch (e: any) {
      if (e?.code === "P2002") return res.status(409).json({ error: "Conexión ya existe" });
      throw e;
    }

    return res.json({
      status: "active",
      botName: botInfo.first_name,
      botUsername: botInfo.username,
    });
  }

  // WhatsApp
  const { agentId, phoneNumberId, accessToken, verifyToken } = req.body ?? {};
  if (!agentId || !phoneNumberId || !accessToken || !verifyToken) {
    return res.status(400).json({
      error: "agentId, phoneNumberId, accessToken y verifyToken son requeridos",
    });
  }

  const publicUrl = PUBLIC_URL();
  const webhookUrl = publicUrl
    ? `${publicUrl}/api/channels/whatsapp/${agentId}`
    : null;

  try {
    await prisma.channelConnection.upsert({
      where: { agentId_provider: { agentId, provider: "whatsapp" } },
      create: {
        agentId,
        provider: "whatsapp",
        credentials: encryptCreds({ phoneNumberId, accessToken, verifyToken }) as unknown as object,
        status: "pending",
      },
      update: {
        credentials: encryptCreds({ phoneNumberId, accessToken, verifyToken }) as unknown as object,
        status: "pending",
        statusDetail: null,
      },
    });
  } catch (e: any) {
    if (e?.code === "P2002") return res.status(409).json({ error: "Conexión ya existe" });
    throw e;
  }

  return res.json({
    status: "pending",
    webhookUrl: webhookUrl ?? "(PUBLIC_URL no configurada)",
    publicUrlConfigured: !!publicUrl,
  });
});

// ── GET /api/channels/:agentId ───────────────────────────────────────────────

channelsRouter.get("/:agentId/status", async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const connections = await prisma.channelConnection.findMany({
    where: { agentId },
  });

  const publicUrl = PUBLIC_URL();
  const publicUrlConfigured = !!publicUrl;

  const result = connections.map((c) => {
    if (c.provider === "telegram") {
      return {
        provider: "telegram",
        status: c.status,
        statusDetail: c.statusDetail ?? undefined,
        botUsername: c.botUsername ?? undefined,
        botName: c.botName ?? undefined,
      };
    }
    // WhatsApp
    let phoneNumberIdMasked: string | undefined;
    try {
      const creds = decryptCreds<WhatsAppCredentials>(c.credentials);
      const pid = creds.phoneNumberId;
      phoneNumberIdMasked = pid.length > 4 ? `****${pid.slice(-4)}` : `****`;
    } catch {}
    return {
      provider: "whatsapp",
      status: c.status,
      statusDetail: c.statusDetail ?? undefined,
      phoneNumberIdMasked,
      webhookUrl: publicUrl ? `${publicUrl}/api/channels/whatsapp/${agentId}` : undefined,
    };
  });

  return res.json({ publicUrlConfigured, connections: result });
});

// ── DELETE /api/channels/:provider/:agentId ──────────────────────────────────

channelsRouter.delete("/:provider/:agentId", async (req: Request, res: Response) => {
  const { provider, agentId } = req.params;

  const conn = await prisma.channelConnection.findUnique({
    where: { agentId_provider: { agentId, provider } },
  });
  if (!conn) return res.status(404).json({ error: "Conexión no encontrada" });

  if (provider === "telegram") {
    try {
      const creds = decryptCreds<{ token: string }>(conn.credentials);
      await tgDeleteWebhook(creds.token);
    } catch (e) {
      console.warn("[channels] deleteWebhook falló al desconectar Telegram:", e);
    }
  }

  await prisma.channelConnection.delete({
    where: { agentId_provider: { agentId, provider } },
  });

  return res.json({ status: "disconnected" });
});

// ── POST /api/channels/telegram/:agentId (webhook receptor) ─────────────────

channelsRouter.post("/telegram/:agentId", async (req: Request, res: Response) => {
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

  // Resolver conversación
  const externalId = String(parsed.chatId);
  const conversationId = await resolveConversation(agentId, "telegram", externalId, {});

  // Llamar pipeline de chat
  let reply: { conversationId: string; text: string };
  try {
    reply = await chatWithAgent(agentId, parsed.text, conversationId, "telegram");
  } catch (e) {
    console.error("[channels/telegram] chatWithAgent error:", e);
    await tgSendMessage(creds.token, parsed.chatId, "Lo siento, ha ocurrido un error.").catch(() => {});
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

  // Responder al usuario
  await tgSendMessage(creds.token, parsed.chatId, reply.text).catch((e) => {
    console.error("[channels/telegram] sendMessage error:", e);
  });

  markProcessed(dedupKey);
  return res.json({ ok: true });
});

// ── GET /api/channels/whatsapp/:agentId (verificación Meta) ─────────────────

channelsRouter.get("/whatsapp/:agentId", async (req: Request, res: Response) => {
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
});

// ── POST /api/channels/whatsapp/:agentId (webhook receptor) ─────────────────

channelsRouter.post("/whatsapp/:agentId", async (req: Request, res: Response) => {
  const { agentId } = req.params;

  // Verificación obligatoria de la firma HMAC del webhook (fail-closed):
  // sin secreto configurado, sin rawBody o con firma inválida → se rechaza.
  // META_APP_SECRET es requisito operativo del canal WhatsApp.
  const appSecret = process.env.META_APP_SECRET;
  const rawBody: Buffer | undefined = (req as any).rawBody;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  if (!appSecret) {
    console.warn("[channels/whatsapp] META_APP_SECRET no configurado; webhook rechazado (fail-closed)");
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
    console.error("[channels/whatsapp] chatWithAgent error:", e);
    await waSendMessage(
      creds.phoneNumberId,
      creds.accessToken,
      parsed.from,
      "Lo siento, ha ocurrido un error."
    ).catch(() => {});
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
    console.error("[channels/whatsapp] sendMessage error:", e);
  });

  markProcessed(dedupKey);
  return res.json({ ok: true });
});
