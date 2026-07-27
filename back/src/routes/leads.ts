/**
 * routes/leads.ts — Kickoff de leads (aa-lead-whatsapp-kickoff F2, design.md §C).
 *
 * `POST /api/leads/kickoff` es el INVERSO del webhook reactivo: entra un lead
 * (landing) → se manda la PLANTILLA de primer contacto por WhatsApp → se SIEMBRA
 * la conversación para que el path reactivo existente la retome con contexto.
 *
 * SEGURIDAD (endpoint público que dispara envíos WhatsApp — coste + reputación):
 *  - Gate por kickoff-token per-agente: sin token válido → 401 ANTES de nada.
 *  - Rate-limit por IP (anti-spam) vía `leadsLimiter`.
 *  - Idempotencia por (agentId, teléfono normalizado): nunca doble envío. El
 *    check→envío→siembra se serializa por lead con un ADVISORY LOCK transaccional
 *    de Postgres (pg_advisory_xact_lock) para cerrar la carrera de doble-submit
 *    concurrente sin necesidad de migrar el esquema (índice único).
 *  - Teléfono validado/normalizado; nunca interpolado en URL.
 *  - Creds WhatsApp per-agente descifradas localmente, nunca logueadas.
 *  - La conversación SOLO se siembra tras un envío de plantilla exitoso.
 */

import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { asyncHandler } from "@/lib/http";
import { leadsLimiter } from "@/lib/limiters";
import { sendTemplate, type WhatsAppCredentials } from "@/lib/channels/whatsapp";
import { decryptCreds, resolveConversation } from "@/lib/channels/webhook-shared";
import { resolveAgentBackendAdapter } from "@/lib/agent-backend/managed-db";
import { assertAgentServableById } from "@/lib/agent/lifecycle";
import {
  resolveLeadTemplate,
  resolveKickoffToken,
  renderBodyParams,
  renderTemplateText,
} from "@/lib/channels/lead-template";

export const leadsRouter = Router();

const kickoffSchema = z.object({
  agentId: z.string().min(1),
  nombre: z.string().min(1).max(200),
  telefono: z.string().min(1).max(40),
  email: z.string().email().optional(),
  peticion: z.string().max(2000).optional(),
  // token opcional en el schema: su ausencia es un fallo de AUTORIZACIÓN (401),
  // no de validación de body (422). El gate de abajo lo exige.
  token: z.string().optional(),
});

/**
 * Normaliza a un teléfono tipo E.164: conserva un '+' inicial y solo dígitos.
 * Devuelve null si el resultado no tiene entre 8 y 15 dígitos (inválido).
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return (hasPlus ? "+" : "") + digits;
}

/** Comparación en tiempo constante (evita timing attacks sobre el token). */
function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Marca interna: fallo de `sendTemplate` DENTRO de la sección crítica. Se lanza
 * para que la transacción revierta (sin filas sembradas) y el handler responda
 * 502, sin confundirlo con errores de BD (que caen en 500 vía asyncHandler).
 */
class KickoffSendError extends Error {}

// ── POST /kickoff ─────────────────────────────────────────────────────────────

leadsRouter.post(
  "/kickoff",
  leadsLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    // (1) Validación de body → 422 (zod inline para controlar el status; el
    // validador compartido devuelve 400, aquí el contrato pide 422).
    const parsed = kickoffSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(422).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    }
    const { agentId, nombre, telefono, email, peticion, token } = parsed.data;

    // Normalizar teléfono (E.164). Inválido → 422 (nunca se interpola en URL).
    const phone = normalizePhone(telefono);
    if (!phone) {
      return res.status(422).json({ error: "Teléfono inválido" });
    }

    // (1b) Gate por kickoff-token del agente. Config de notificaciones del backend.
    const backend = await prisma.agentDataBackend.findUnique({ where: { agentId } });
    const kickoffToken = resolveKickoffToken(backend?.notificationConfig);
    // Sin token en la petición, sin token configurado en el agente, O token
    // inválido → 401. INVARIANTE: el envío WhatsApp NUNCA ocurre sin token válido.
    if (!token || !kickoffToken || !tokensEqual(token, kickoffToken)) {
      return res.status(401).json({ error: "No autorizado" });
    }

    // (1c) H3 (aa-agente-ciclo-vida-publicacion, T2.5) — Gate de PUBLICACIÓN. Esta vía no
    // pasa por `runAgent`, así que no hereda el gate del cuello, y sin embargo es la más
    // comprometida de todas: manda un WhatsApp a una persona real y gasta cuota de plantilla
    // de Meta. Un agente sin publicar no contacta a nadie. Va DESPUÉS del token para no
    // revelar el estado del agente a quien no tiene autorización.
    await assertAgentServableById(agentId);

    // (2) Resolver credenciales WhatsApp del agente (per-agente, cifradas).
    const conn = await prisma.channelConnection.findUnique({
      where: { agentId_provider: { agentId, provider: "whatsapp" } },
    });
    if (!conn) {
      return res.status(409).json({ error: "El agente no tiene WhatsApp conectado" });
    }
    let creds: WhatsAppCredentials;
    try {
      creds = decryptCreds<WhatsAppCredentials>(conn.credentials);
    } catch {
      return res.status(500).json({ error: "Error interno" });
    }

    // (3) Idempotencia: conversación existente para (agentId, phone) → no reenviar.
    const existing = await resolveConversation(agentId, "whatsapp", phone, {});
    if (existing) {
      return res.status(200).json({ status: "already_started", conversationId: existing });
    }

    // (4) Crear Contacto en el CRM (best-effort — no bloquea el WhatsApp). El
    // adapter aplica su propio gate de capability `leads` (lanza si no está
    // habilitada); lo tratamos como best-effort.
    try {
      const adapter = await resolveAgentBackendAdapter(agentId);
      if (adapter) {
        await adapter.guardarLead({ nombre, email, telefono: phone }, peticion ?? "");
      }
    } catch (e) {
      logger.warn({ err: e, agentId }, "[leads/kickoff] guardarLead best-effort falló");
    }

    // (5) Sección crítica serializada por lead contra el doble-submit concurrente.
    //
    // El check (3) de idempotencia es read-then-write: dos kickoffs casi
    // simultáneos para el mismo (agentId, phone) pueden pasar AMBOS el findFirst
    // (aún no hay fila) y disparar DOS envíos de plantilla (coste + reputación del
    // número). No añadimos un índice único sobre Conversation (filas duplicadas
    // legítimas en prod harían fallar la migración; resolveConversation ya tolera
    // duplicados vía findFirst orderBy desc). En su lugar serializamos con un
    // ADVISORY LOCK transaccional de Postgres sobre una clave estable del lead: el
    // lock se adquiere al entrar y se AUTO-LIBERA al terminar la transacción
    // (pg_advisory_xact_lock, xact-scoped).
    //
    // TRADEOFF: `sendTemplate` hace I/O de red y DEBE ejecutarse dentro del lock
    // (la sección race-safe es check→send→create, indivisible). Mantenemos el
    // alcance mínimo y acotamos con el `timeout` de la transacción para no retener
    // el lock indefinidamente. NOTA: `sendTemplate` no tiene AbortController/timeout
    // propio (fetch sin abort), por lo que el `timeout` de la transacción es la
    // única cota superior sobre cuánto se retiene el lock.
    const lockKey = `kickoff:${agentId}:${phone}`;
    const template = resolveLeadTemplate(backend?.notificationConfig);
    const bodyParams = renderBodyParams(template, { nombre, email, telefono: phone, peticion });
    const text = renderTemplateText(template, bodyParams);

    let outcome: { status: "started" | "already_started"; conversationId: string };
    try {
      outcome = await prisma.$transaction(
        async (tx) => {
          // Serializa las requests concurrentes del mismo lead. hashtext() mapea la
          // clave a int4 estable (el argumento va parametrizado, nunca interpolado).
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

          // Re-chequeo DENTRO del lock: si otra request ya sembró la conversación
          // mientras esperábamos el lock → already_started, SIN reenviar plantilla.
          const already = await resolveConversation(agentId, "whatsapp", phone, {});
          if (already) {
            return { status: "already_started" as const, conversationId: already };
          }

          // Envío de plantilla dentro del lock. Fallo Graph → KickoffSendError → la
          // transacción revierte (sin filas sembradas) y el handler responde 502.
          try {
            await sendTemplate(
              creds.phoneNumberId,
              creds.accessToken,
              phone,
              { name: template.name, language: template.language },
              bodyParams
            );
          } catch (e) {
            logger.error({ err: e, agentId }, "[leads/kickoff] sendTemplate falló");
            throw new KickoffSendError();
          }

          // Siembra Conversation + Message assistant (contexto del turno reactivo).
          const conversation = await tx.conversation.create({
            data: {
              agentId,
              channel: "whatsapp",
              metadata: { externalId: phone, leadFlow: true, source: "kickoff" },
            },
          });
          await tx.message.create({
            data: { conversationId: conversation.id, role: "assistant", content: text },
          });
          return { status: "started" as const, conversationId: conversation.id };
        },
        // Cota superior sobre la retención del lock (cubre el envío de red).
        { timeout: 15_000 }
      );
    } catch (e) {
      if (e instanceof KickoffSendError) {
        return res.status(502).json({ error: "No se pudo enviar el mensaje de WhatsApp" });
      }
      throw e; // Error de BD → 500 vía asyncHandler.
    }

    // (6)
    return res.status(200).json(outcome);
  })
);
