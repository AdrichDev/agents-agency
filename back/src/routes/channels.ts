import { Router, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { encrypt } from "@/lib/crypto";
import {
  validateToken,
  registerWebhook,
  deleteWebhook as tgDeleteWebhook,
} from "@/lib/channels/telegram";
import { type WhatsAppCredentials } from "@/lib/channels/whatsapp";
import {
  PUBLIC_URL,
  encryptCreds,
  decryptCreds,
} from "@/lib/channels/webhook-shared";
import { handleTelegramWebhook } from "@/lib/channels/telegram-webhook";
import {
  handleWhatsAppVerify,
  handleWhatsAppWebhook,
} from "@/lib/channels/whatsapp-webhook";
import { provisionTelegramChannel } from "@/lib/openclaw/provision";

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

    // F2 (aa-openclaw-brain): si el agente es runtime="openclaw", OpenClaw
    // hace polling del bot — AA NUNCA registra su propio webhook para esta
    // conexión (F2-T3, doble respuesta). El handover del token vive en
    // provisionTelegramChannel (F2-T2), llamado tras el upsert de abajo.
    const owningAgent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { runtime: true },
    });
    const isOpenclawManaged = owningAgent?.runtime === "openclaw";

    // Generar webhookSecret y registrar webhook — solo para conexiones NO
    // gestionadas por OpenClaw. Si la conexión pasa a ser openclaw-managed y
    // ya había un webhook (p.ej. venía de runtime="openai"), se borra en el
    // handover para no duplicar respuestas.
    const webhookSecret = randomBytes(32).toString("hex");
    const webhookUrl = `${publicUrl}/api/channels/telegram/${agentId}`;

    if (isOpenclawManaged) {
      await tgDeleteWebhook(token); // no-op si no había webhook; nunca lanza (ver lib/channels/telegram.ts)
    } else {
      try {
        await registerWebhook(token, webhookUrl, webhookSecret);
      } catch (e) {
        return res.status(502).json({ error: "Error al registrar webhook en Telegram" });
      }
    }

    const metadata = isOpenclawManaged ? { managedBy: "openclaw" } : {};

    // Upsert connection
    try {
      await prisma.channelConnection.upsert({
        where: { agentId_provider: { agentId, provider: "telegram" } },
        create: {
          agentId,
          provider: "telegram",
          credentials: encryptCreds({ token }) as unknown as object,
          status: "active",
          webhookSecret: isOpenclawManaged ? null : webhookSecret,
          botUsername: botInfo.username,
          botName: botInfo.first_name,
          metadata,
        },
        update: {
          credentials: encryptCreds({ token }) as unknown as object,
          status: "active",
          webhookSecret: isOpenclawManaged ? null : webhookSecret,
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

    // F2-T2: handover del token a OpenClaw channels.telegram. No bloqueante
    // — nunca falla la petición de conexión porque el gateway esté caído
    // (fail-soft, ver lib/openclaw/provision.ts). El token viaja cifrado
    // hasta aquí y se descifra SOLO dentro de provisionTelegramChannel.
    if (isOpenclawManaged) {
      provisionTelegramChannel({ agentId, encryptedCredentials: encryptCreds({ token }) }).catch((e) =>
        logger.error({ err: e }, `[channels] openclaw telegram handover failed agentId=${agentId}:`)
      );
    }

    return res.json({
      status: "active",
      botName: botInfo.first_name,
      botUsername: botInfo.username,
      managedBy: isOpenclawManaged ? "openclaw" : undefined,
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
