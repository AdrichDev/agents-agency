import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { HttpError } from "@/lib/http";

/**
 * Metering de tokens por cliente. El agente de cada cliente consume de la cuenta
 * LLM del propietario; aquí se contabiliza el gasto y se bloquea al agotar el cupo.
 *
 * Comportamiento confirmado:
 *  - tokenBalance = 0  → bloqueado (el propietario debe asignar cupo).
 *  - Agente sin tenant → BLOQUEADO (402). Ver `assertUsageAllowed`.
 *
 * H1 (aa-metering-fail-closed): hasta este change, un agente sin tenant no pasaba por
 * ningún control ("uso interno, ilimitado"), premisa válida cuando AA era una herramienta
 * interna. Al vender agentes esa premisa se invierte: lo que no es cobrable no es servible.
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
 * H1 (aa-metering-fail-closed) — Gate de uso FAIL-CLOSED, fuente única para todos los
 * canales (widget/API, Telegram, WhatsApp). Se invoca desde `runAgent`, el cuello por el
 * que pasa todo consumo de LLM, de modo que un canal nuevo hereda el control por
 * construcción en lugar de tener que recordarlo.
 *
 * Decisión: un agente sin tenant NO es servible (402). Antes quedaba fuera de todo control
 * y consumía la cuenta LLM de la plataforma sin cupo ni registro.
 *
 * Excepción `isTest`: la consola de pruebas del operador (autenticada, tras el panel) debe
 * poder hablar con un agente recién creado que todavía no tiene tenant — el flujo es
 * crear → probar → asignar tenant → publicar. Su coste es de plataforma y se acota en H4
 * (cuota de plataforma), no aquí.
 *
 * La exención es ACOTADA: sólo dispensa del requisito de *tener tenant*. Si el agente ya
 * tiene uno, el cupo y el kill switch se comprueban igual, probando o no — de lo contrario la
 * consola sería una vía para seguir atendiendo a un tenant que dejó de pagar, y `deductTokens`
 * le seguiría cargando el consumo.
 *
 * @returns el tenantId a usar para contabilizar, o null si no hay (sólo posible con isTest).
 * @throws HttpError 402 si el agente no es facturable o el tenant no tiene cupo.
 */
export async function assertUsageAllowed(
  tenantId: string | null | undefined,
  opts: { isTest?: boolean } = {}
): Promise<string | null> {
  if (!tenantId) {
    if (opts.isTest) return null;
    throw new HttpError(
      402,
      "Este asistente no está asignado a ningún cliente y no puede usarse. Contacta con el administrador."
    );
  }
  await checkClientBalance(tenantId);
  return tenantId;
}

/**
 * Contabiliza el consumo tras una respuesta: incrementa tokensUsed, registra el log
 * y desactiva al cliente si alcanzó su cupo. Best-effort: nunca rompe la respuesta al
 * usuario (el chat ya se resolvió cuando se llama a esto).
 *
 * `conversationId` admite `null`: hay consumo de agente sin conversación (automatizaciones y
 * cron, que llaman a `runAgent` directamente). La columna ya era opcional en el schema; la
 * firma era más estricta de lo necesario y eso dejaba ese consumo sin registrar.
 * `operacion` tipifica el consumo en `uso_tokens` para poder separarlo por origen.
 */
export async function deductTokens(
  clientId: string,
  agentId: string,
  conversationId: string | null,
  tokens: number,
  model: string,
  operacion?: string
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
        data: { tenantId: clientId, agentId, conversationId, tokens, model, operacion },
      }),
    ]);
    // Si alcanzó el cupo, bloquear para la próxima llamada.
    if (client.isActive && client.tokensUsed >= client.tokenBalance) {
      await prisma.tenant.update({ where: { id: clientId }, data: { isActive: false } });
    }
  } catch (e) {
    logger.error({ err: e }, "[token-metering] deductTokens:");
  }
}
