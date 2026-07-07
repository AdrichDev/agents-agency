import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendMessage as tgSendMessage } from "@/lib/channels/telegram";
import { decryptCreds } from "@/lib/channels/webhook-shared";
import { requireOperatorToken } from "@/lib/operator-token";
import { fanOutTelegramToCrm } from "@/lib/channels/crm-telegram-fanout";

// ---------------------------------------------------------------------------
// Router de servicio Telegram (5.4b aa-centro-mando-agenda-telegram).
// Implementa el contrato TELEGRAM_SEND_URL del CRM: respuestas manuales
// escritas desde creador_CRM salen por AQUÍ — AA es el ÚNICO escritor hacia
// la Bot API de Telegram (arquitectura «AA canal + cerebro OpenClaw»).
//
// Server-to-server: protegido SOLO por el service token (x-service-token,
// OPERATOR_SERVICE_TOKEN), montado FUERA de /api → no pasa por el gate de
// usuario. Mismo patrón que /service/operator (lib/operator-token.ts).
//
// A diferencia de los hooks fail-soft del repo, aquí el fallo de envío NO se
// silencia: el CRM necesita saber si el mensaje salió para marcarlo
// "pendiente" → 502 con detalle de error.
// ---------------------------------------------------------------------------

export const serviceTelegramRouter = Router();

// Todo el router exige el service token.
serviceTelegramRouter.use(requireOperatorToken());

const sendSchema = z.object({
  /** Id de negocio del CRM. Aceptado por contrato; el mapeo negocio↔agente AA es 5.4c. */
  businessId: z.string().optional(),
  conversationId: z.string().min(1),
  text: z.string().min(1),
  /** Clave de idempotencia del CRM: replay con el mismo id NO re-envía. */
  clientMessageId: z.string().optional(),
});

/**
 * POST /service/telegram/send — envía una respuesta manual del CRM por el bot
 * del agente dueño de la conversación y la persiste como Message saliente.
 * Idempotente por clientMessageId (mismo patrón que el envío manual de la UI
 * en routes/channels.ts): si ya existe el mensaje, se devuelve sin re-enviar.
 */
export async function serviceTelegramSendHandler(req: Request, res: Response) {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { businessId, conversationId, text, clientMessageId } = parsed.data;

  try {
    // Idempotencia: replay → devolver el mensaje ya persistido y NO re-enviar.
    if (clientMessageId) {
      const existing = await prisma.message.findUnique({ where: { id: clientMessageId } });
      if (existing) return res.json(existing);
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) return res.status(404).json({ error: "Conversación no encontrada" });

    const metadata = (conversation.metadata as Record<string, unknown> | null) ?? {};
    const externalId = metadata.telegramChatId ?? metadata.externalId;
    if (!externalId) {
      return res
        .status(400)
        .json({ error: "La conversación no tiene un ID de chat de Telegram asociado" });
    }

    const conn = await prisma.channelConnection.findUnique({
      where: { agentId_provider: { agentId: conversation.agentId, provider: "telegram" } },
    });
    if (!conn) {
      return res.status(404).json({ error: "El agente no tiene conectado el canal de Telegram" });
    }

    let creds: { token: string };
    try {
      creds = decryptCreds<{ token: string }>(conn.credentials);
    } catch {
      return res.status(500).json({ error: "Error descifrando credenciales de Telegram" });
    }

    // Envío real a Telegram. NO fail-soft: si Telegram rechaza el mensaje, el
    // CRM debe enterarse (502) para marcar la respuesta como pendiente.
    try {
      await tgSendMessage(creds.token, Number(externalId), text);
    } catch (e) {
      logger.error({ err: e }, "[service-telegram] fallo enviando a la Bot API:");
      return res.status(502).json({
        error: "telegram_send_failed",
        detail: e instanceof Error ? e.message : "Error al enviar mensaje por Telegram",
      });
    }

    // Persistir el saliente con el id de idempotencia del CRM.
    try {
      const message = await prisma.message.create({
        data: {
          id: clientMessageId,
          conversationId,
          role: "assistant",
          content: text,
        },
      });
      await fanOutTelegramToCrm({
        businessId,
        conversationId,
        direction: "out",
        text,
        clientMessageId: clientMessageId ?? message.id,
      });
      return res.json(message);
    } catch (e: any) {
      // Carrera de replays concurrentes: otro request persistió el mismo
      // clientMessageId entre el chequeo inicial y este create → devolver el
      // existente (mismo contrato que el replay secuencial).
      if (e?.code === "P2002" && clientMessageId) {
        const existing = await prisma.message.findUnique({ where: { id: clientMessageId } });
        if (existing) return res.json(existing);
      }
      throw e;
    }
  } catch (e) {
    logger.error({ err: e }, "[service-telegram] error en send:");
    return res.status(500).json({ error: "No se pudo enviar el mensaje" });
  }
}

serviceTelegramRouter.post("/send", serviceTelegramSendHandler);
