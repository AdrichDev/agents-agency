/**
 * Ritmo de conversación de un agente en un canal de mensajería
 * (aa-canales-buffer-y-respuesta-partida).
 *
 * Módulo aparte de `webhook-shared` A PROPÓSITO: varios tests de webhook mockean
 * `webhook-shared` con una factoría parcial, y añadir exports ahí los rompería
 * sin que hubiera ningún fallo real de producto. Aquí el módulo se carga de
 * verdad en esos tests y, con `prisma` mockeado, degrada solo a `PACING_OFF`.
 */

import { prisma } from "@/lib/db";
import {
  splitReply,
  clampReplyMaxMessages,
  clampReplyPauseMs,
} from "@/lib/channels/reply-split";
import { clampBufferWindowMs } from "@/lib/channels/inbound-buffer";

/** Cómo debe conversar el agente en un canal de mensajería. */
export interface ConversationPacing {
  /** Ventana de agrupación de entrantes, en ms. 0 = desactivado. */
  inboundBufferMs: number;
  /** Máximo de mensajes por respuesta. 1 = sin partir. */
  replyMaxMessages: number;
  /** Pausa entre mensajes de una respuesta partida, en ms. */
  replySplitPauseMs: number;
}

/** Ritmo neutro: reproduce el comportamiento previo al change (AD2). */
export const PACING_OFF: ConversationPacing = {
  inboundBufferMs: 0,
  replyMaxMessages: 1,
  replySplitPauseMs: 0,
};

/** true si el agente tiene algún ajuste de ritmo activo. */
export function hasPacing(p: ConversationPacing): boolean {
  return p.inboundBufferMs > 0 || p.replyMaxMessages > 1;
}

/**
 * Lee el ritmo configurado del agente, ya recortado a los topes duros.
 *
 * El recorte se hace AQUÍ y no al guardar, para que bajar un tope en el futuro
 * afecte también a los agentes ya configurados (AD5).
 *
 * Ante cualquier problema (agente inexistente, prisma parcialmente mockeado en
 * tests, error de lectura) devuelve `PACING_OFF`: el ritmo es una mejora de
 * presentación, nunca un motivo para dejar a un cliente sin respuesta.
 */
export async function getAgentPacing(agentId: string): Promise<ConversationPacing> {
  try {
    if (typeof (prisma as any).agent?.findUnique !== "function") return PACING_OFF;
    const agent = await (prisma as any).agent.findUnique({
      where: { id: agentId },
      select: {
        inboundBufferMs: true,
        replyMaxMessages: true,
        replySplitPauseMs: true,
      },
    });
    if (!agent) return PACING_OFF;
    return {
      inboundBufferMs: clampBufferWindowMs(agent.inboundBufferMs),
      replyMaxMessages: clampReplyMaxMessages(agent.replyMaxMessages),
      replySplitPauseMs: clampReplyPauseMs(agent.replySplitPauseMs),
    };
  } catch {
    return PACING_OFF;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Envía la respuesta troceada según el ritmo, aplicando `send` a cada trozo.
 *
 * `send` recibe el trozo EN CRUDO: el formateador del canal (`toWhatsAppText` /
 * `toTelegramHtml`) se aplica dentro del emisor de cada canal, sobre el trozo ya
 * cortado — trocear texto ya convertido a HTML podría dejar una etiqueta
 * abierta (AD4).
 *
 * Con `replyMaxMessages = 1` (default) esto es una sola llamada a `send` con el
 * texto íntegro: exactamente el comportamiento anterior al change.
 *
 * Si un trozo falla, se abortan los siguientes: media respuesta entregada se lee
 * peor que una respuesta que no llegó.
 */
export async function sendReplyInChunks(
  text: string,
  pacing: ConversationPacing,
  send: (chunk: string) => Promise<void>
): Promise<void> {
  const chunks = splitReply(text, pacing.replyMaxMessages);
  if (chunks.length === 0) return;

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0 && pacing.replySplitPauseMs > 0) await sleep(pacing.replySplitPauseMs);
    await send(chunks[i]);
  }
}
