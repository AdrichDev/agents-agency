import { Router, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { encrypt } from "@/lib/crypto";
import { asyncHandler, validate, HttpError } from "@/lib/http";
import {
  validateToken,
  registerWebhook,
  deleteWebhook as tgDeleteWebhook,
  sendMessage as tgSendMessage,
} from "@/lib/channels/telegram";
import { type WhatsAppCredentials } from "@/lib/channels/whatsapp";
import {
  PUBLIC_URL,
  encryptCreds,
  decryptCreds,
} from "@/lib/channels/webhook-shared";
import { handleTelegramWebhook } from "@/lib/channels/telegram-webhook";
import { fanOutTelegramToCrm } from "@/lib/channels/crm-telegram-fanout";
import {
  handleWhatsAppVerify,
  handleWhatsAppWebhook,
} from "@/lib/channels/whatsapp-webhook";

export const channelsRouter = Router();

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

    // Arquitectura «AA canal + cerebro OpenClaw» (aa-centro-mando-agenda-telegram,
    // 5.4a): AA es el hub de bots de clientes y registra SIEMPRE su propio
    // webhook por agente, sea cual sea el runtime. Los agentes runtime="openclaw"
    // usan el cerebro de OpenClaw vía getClientForAgent en el pipeline de chat
    // (lib/openai.ts) — el token del bot NUNCA se entrega a OpenClaw (su slot
    // channels.telegram.botToken es global y no soporta multi-bot).
    const webhookSecret = randomBytes(32).toString("hex");
    const webhookUrl = `${publicUrl}/api/channels/telegram/${agentId}`;

    try {
      await registerWebhook(token, webhookUrl, webhookSecret);
    } catch (e) {
      return res.status(502).json({ error: "Error al registrar webhook en Telegram" });
    }

    const metadata = {};

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
          metadata,
        },
        update: {
          credentials: encryptCreds({ token }) as unknown as object,
          status: "active",
          webhookSecret,
          botUsername: botInfo.username,
          botName: botInfo.first_name,
          statusDetail: null,
          metadata,
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
        managedBy: (c.metadata as any)?.managedBy ?? undefined, // F2 (aa-openclaw-brain)
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
      logger.warn({ err: e }, "[channels] deleteWebhook falló al desconectar Telegram:");
    }
  }

  await prisma.channelConnection.delete({
    where: { agentId_provider: { agentId, provider } },
  });

  return res.json({ status: "disconnected" });
});

// ── Webhooks (handlers extraídos a @/lib/channels/*-webhook) ─────────────────

// POST /api/channels/telegram/:agentId (webhook receptor)
channelsRouter.post("/telegram/:agentId", handleTelegramWebhook);

// GET /api/channels/whatsapp/:agentId (verificación Meta)
channelsRouter.get("/whatsapp/:agentId", handleWhatsAppVerify);

// POST /api/channels/whatsapp/:agentId (webhook receptor)
channelsRouter.post("/whatsapp/:agentId", handleWhatsAppWebhook);

// GET /api/channels/telegram/conversations - Listar conversaciones de Telegram
channelsRouter.get(
  "/telegram/conversations",
  asyncHandler(async (req, res) => {
    const conversations = await prisma.conversation.findMany({
      // F1 (aa-agente-consola-pruebas, T1.3): excluye conversaciones de la consola
      // de pruebas del operador — el cliente no debe ver ese ruido en su bandeja.
      where: { channel: "telegram", isTest: false },
      include: {
        agent: { select: { name: true } },
        lead: { select: { customerName: true, email: true, phone: true } },
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(conversations);
  })
);

// GET /api/channels/telegram/conversations/:id/messages - Obtener mensajes de una conversación
channelsRouter.get(
  "/telegram/conversations/:id/messages",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
    });
    res.json(messages);
  })
);

// POST /api/channels/telegram/conversations/:id/messages - Envío manual desde la UI con registro idempotente
const sendManualMessageSchema = z.object({
  content: z.string().min(1),
  clientMsgId: z.string().optional(),
});

channelsRouter.post(
  "/telegram/conversations/:id/messages",
  validate.body(sendManualMessageSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { content, clientMsgId } = req.validatedBody as z.infer<typeof sendManualMessageSchema>;

    if (clientMsgId) {
      const existing = await prisma.message.findUnique({
        where: { id: clientMsgId },
      });
      if (existing) {
        return res.json(existing);
      }
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { agent: true },
    });
    if (!conversation) throw new HttpError(404, "Conversación no encontrada");

    const metadata = (conversation.metadata as any) || {};
    const externalId = metadata.telegramChatId || metadata.externalId;
    if (!externalId) throw new HttpError(400, "La conversación no tiene un ID de chat de Telegram asociado");

    const conn = await prisma.channelConnection.findUnique({
      where: { agentId_provider: { agentId: conversation.agentId, provider: "telegram" } },
    });
    if (!conn) throw new HttpError(404, "El agente no tiene conectado el canal de Telegram");

    let creds: { token: string };
    try {
      creds = decryptCreds<{ token: string }>(conn.credentials);
    } catch {
      throw new HttpError(500, "Error descifrando credenciales de Telegram");
    }

    // Enviar mensaje real a Telegram
    await tgSendMessage(creds.token, Number(externalId), content);

    // Guardar mensaje en DB con clientMsgId (idempotencia)
    const message = await prisma.message.create({
      data: {
        id: clientMsgId,
        conversationId: id,
        role: "assistant",
        content,
      },
    });

    res.json(message);
  })
);

