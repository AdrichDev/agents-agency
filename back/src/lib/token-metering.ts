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
 * H4 (aa-planes-y-cuotas, T1.3) — Los dos motivos de corte son hechos distintos y el cliente
 * merece saber cuál le aplica: "he gastado mi cuota" se resuelve renovando, "mi cuenta está
 * desactivada" no. Ninguno de los dos revela detalle interno.
 */
const MSG_SUSPENDIDO =
  "Este asistente está desactivado temporalmente. Contacta con el administrador.";
const MSG_CUOTA =
  "Se ha agotado el cupo de uso de este asistente. Contacta con el administrador.";

/**
 * Comprueba si un cliente puede usar su asistente. Lanza 402 si está bloqueado
 * (inactivo o sin cupo). Se llama ANTES de procesar el mensaje.
 *
 * @returns el modo de credenciales del cliente ("platform" | "byok"), que decide qué cliente
 *   LLM se usará y a quién se le carga el consumo.
 */
export async function checkClientBalance(clientId: string): Promise<string> {
  const client = await prisma.tenant.findUnique({
    where: { id: clientId },
    select: { isActive: true, tokenBalance: true, tokensUsed: true, credentialMode: true },
  });
  // Cliente borrado: se trata como desactivado, no se distingue hacia fuera.
  if (!client) throw new HttpError(402, MSG_SUSPENDIDO);
  // `isActive` es ya SÓLO estado administrativo (impago o suspensión manual), nunca
  // consecuencia de agotar el cupo. Ver H4 §C.1.
  //
  // H2: este corte aplica A LOS DOS MODOS, y es deliberado. `isActive` es el kill switch del
  // IMPAGO de la suscripción; traer tu propia clave no es dejar de ser cliente. Si el modo byok
  // dispensara también de esto, BYOK sería la forma de seguir siendo atendido sin pagar.
  if (!client.isActive) throw new HttpError(402, MSG_SUSPENDIDO);
  // El cupo, en cambio, aplica SÓLO en "platform": es el guardarraíl del gasto LLM del
  // propietario, y en byok ese gasto no existe — lo paga el cliente a su proveedor. Racionar
  // ahí un coste que nadie asume sería cortar el servicio sin ningún motivo económico.
  if (client.credentialMode !== "byok" && client.tokensUsed >= client.tokenBalance) {
    throw new HttpError(402, MSG_CUOTA);
  }
  return client.credentialMode;
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
 * H2 (aa-credenciales-byok-multiproveedor): devuelve además el modo de credenciales, porque
 * quien llama necesita DOS cosas del mismo gate y en el mismo instante: a quién contabilizar y
 * con qué clave hablar con el LLM. Devolverlas juntas evita una segunda lectura del tenant que
 * podría ver un valor distinto al que acaba de autorizar el paso.
 *
 * @returns `meteredTenantId` a usar para contabilizar (null sólo posible con isTest) y el
 *   `credentialMode` efectivo. Sin tenant el modo es "platform": no hay cliente que traiga
 *   clave, así que ese consumo es de la plataforma (y sólo ocurre en pruebas).
 * @throws HttpError 402 si el agente no es facturable o el tenant no tiene cupo.
 */
export async function assertUsageAllowed(
  tenantId: string | null | undefined,
  opts: { isTest?: boolean } = {}
): Promise<{ meteredTenantId: string | null; credentialMode: string }> {
  if (!tenantId) {
    if (opts.isTest) return { meteredTenantId: null, credentialMode: "platform" };
    throw new HttpError(
      402,
      "Este asistente no está asignado a ningún cliente y no puede usarse. Contacta con el administrador."
    );
  }
  const credentialMode = await checkClientBalance(tenantId);
  return { meteredTenantId: tenantId, credentialMode };
}

/**
 * Contabiliza el consumo tras una respuesta: incrementa tokensUsed y registra el log.
 * Best-effort: nunca rompe la respuesta al usuario (el chat ya se resolvió cuando se llama
 * a esto).
 *
 * H4 (T1.1) — NO desactiva al cliente al agotar el cupo. Antes lo hacía, y era doblemente
 * malo: no aportaba bloqueo (`checkClientBalance` ya corta comparando saldo contra consumo)
 * y contaminaba `isActive`, que es el estado de PAGO. Con ambos hechos en un solo booleano,
 * recargar el crédito de un cliente moroso lo reactivaba sin que nadie lo decidiera.
 *
 * `conversationId` admite `null`: hay consumo de agente sin conversación (automatizaciones y
 * cron, que llaman a `runAgent` directamente). La columna ya era opcional en el schema; la
 * firma era más estricta de lo necesario y eso dejaba ese consumo sin registrar.
 * `operacion` tipifica el consumo en `uso_tokens` para poder separarlo por origen.
 *
 * H2 — `credentialMode` decide DOS cosas:
 *  1. Si se incrementa `tokensUsed`. En byok no se incrementa: ese contador es el consumo
 *     contra el cupo, y en byok no hay cupo que consumir. Incrementarlo dejaría a un cliente
 *     que trae su clave con un contador creciendo hacia un límite que no le aplica — y el día
 *     que pasara a "platform" arrancaría ya agotado.
 *  2. Qué se guarda en la fila de `uso_tokens`, que se registra SIEMPRE en los dos modos: el
 *     propietario necesita ver el volumen de todos sus clientes, y la columna es lo que le
 *     permite separar lo que le costó dinero de lo que pagó el cliente.
 *
 * Se pasa el MODO y no un booleano tipo `countsAgainstQuota`: el booleano guardaría la
 * consecuencia y perdería el hecho, que es justo el dato que hay que poder consultar después.
 */
export async function deductTokens(
  clientId: string,
  agentId: string,
  conversationId: string | null,
  tokens: number,
  model: string,
  operacion?: string,
  credentialMode: string = "platform"
): Promise<void> {
  if (tokens <= 0) return;
  const usageData = {
    tenantId: clientId,
    agentId,
    conversationId,
    tokens,
    model,
    operacion,
    credentialMode,
  };
  try {
    if (credentialMode === "byok") {
      await prisma.tokenUsage.create({ data: usageData });
      return;
    }
    await prisma.$transaction([
      prisma.tenant.update({
        where: { id: clientId },
        data: { tokensUsed: { increment: tokens } },
      }),
      prisma.tokenUsage.create({ data: usageData }),
    ]);
  } catch (e) {
    logger.error({ err: e }, "[token-metering] deductTokens:");
  }
}
