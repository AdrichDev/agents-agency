import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";

/**
 * Metering de tokens por cliente. El widget de cada cliente consume de la cuenta
 * OpenAI del propietario; aquí se contabiliza el gasto y se bloquea al agotar el cupo.
 *
 * Comportamiento confirmado:
 *  - tokenBalance = 0  → bloqueado (el propietario debe asignar cupo).
 *  - Agente sin clientId → sin metering (uso interno, ilimitado).
 */

/**
 * Comprueba si un cliente puede usar su asistente. Lanza 402 si está bloqueado
 * (inactivo o sin cupo). Se llama ANTES de procesar el mensaje.
 */
export async function checkClientBalance(clientId: string): Promise<void> {
  const client = await prisma.tenant.findUnique({
    where: { id: clientId },
    select: { isActive: true, tokenBalance: true, tokensUsed: true },
  });
  // Cliente borrado o sin cupo, o ya marcado inactivo → bloqueado.
  if (!client || !client.isActive || client.tokensUsed >= client.tokenBalance) {
    throw new HttpError(402, "Límite de uso del asistente excedido. Contacta con el administrador.");
  }
}

/**
 * Contabiliza el consumo tras una respuesta: incrementa tokensUsed, registra el log
 * y desactiva al cliente si alcanzó su cupo. Best-effort: nunca rompe la respuesta al
 * usuario (el chat ya se resolvió cuando se llama a esto).
 */
export async function deductTokens(
  clientId: string,
  agentId: string,
  conversationId: string,
  tokens: number,
  model: string
): Promise<void> {
  if (tokens <= 0) return;
  try {
    const [client] = await prisma.$transaction([
      prisma.tenant.update({
        where: { id: clientId },
        data: { tokensUsed: { increment: tokens } },
        select: { tokenBalance: true, tokensUsed: true, isActive: true },
      }),
      prisma.tokenUsage.create({
        data: { tenantId: clientId, agentId, conversationId, tokens, model },
      }),
    ]);
    // Si alcanzó el cupo, bloquear para la próxima llamada.
    if (client.isActive && client.tokensUsed >= client.tokenBalance) {
      await prisma.tenant.update({ where: { id: clientId }, data: { isActive: false } });
    }
  } catch (e) {
    console.error("[token-metering] deductTokens:", e);
  }
}
