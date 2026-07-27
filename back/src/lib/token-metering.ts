import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { HttpError } from "@/lib/http";
import { resolveCurrentPeriod } from "@/lib/billing-period";
import {
  countBillableAgents,
  quotaNeedsAgentCount,
  resolveAgentQuota,
  resolveTokenQuota,
  sumAgentPeriodUsage,
} from "@/lib/quota";

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
// H7 — Aquí vivía `MSG_SIN_PLAN` ("Este asistente no tiene un plan de uso asignado"), el corte del
// tenant sin plan ni override. Se retira porque ese caso ya no existe: `resolveTokenQuota` le da el
// cupo por defecto de la plataforma. El fail-closed de H1 no se afloja, se mueve — `tokenBalance = 0`
// sigue cortando por `MSG_CUOTA`, que es el mensaje correcto para un cliente bloqueado a mano.
/**
 * H4 (T5) — Tercer motivo: ESTE agente llegó a su tope, aunque el cliente tenga cupo de sobra.
 * Hereda la separación de T1.3 al nivel del agente: un agente topado NO es un cliente suspendido,
 * y decirle "cuenta desactivada" mandaría al operador a revisar el pago cuando lo único que hay
 * que hacer es subirle el tope a un asistente o repartir el uso.
 */
const MSG_CUOTA_AGENTE =
  "Este asistente ha alcanzado su límite de uso. Contacta con el administrador.";
/**
 * H6 (aa-stripe-suscripciones, T5.1) — Cuarto motivo: la suscripción no está al corriente.
 *
 * Constante propia y no `MSG_SUSPENDIDO` porque cambia QUIÉN tiene que actuar. "Contacta con el
 * administrador" manda al cliente a esperar a otro; un impago lo resuelve él, y sólo él. Decirle lo
 * genérico sería mandarlo a la puerta equivocada y alargar el corte sin motivo.
 */
const MSG_IMPAGO =
  "El servicio está suspendido porque hay un pago pendiente. Regulariza la suscripción para reactivarlo.";

/**
 * H6 (§D3) — Estados de Stripe que cortan el servicio.
 *
 * UNA sola lista, y aquí. Los manejadores del webhook guardan el estado tal cual lo dice Stripe y no
 * traducen nada; si cada manejador decidiera de paso si su estado "merece" cortar, la política de corte
 * quedaría repartida por cinco sitios y nadie podría responder a "¿qué corta hoy?" sin leerlos todos.
 *
 * `trialing` e `incomplete` **no** cortan: en el primero el cliente está dentro de lo pactado, y en el
 * segundo el primer cobro aún se está resolviendo — cortar ahí sería cortar durante el alta.
 */
const SUBSCRIPTION_BLOCKING_STATUSES = new Set(["past_due", "unpaid", "canceled"]);

/**
 * Comprueba si un cliente puede usar su asistente. Lanza 402 si está bloqueado
 * (inactivo o sin cupo). Se llama ANTES de procesar el mensaje.
 *
 * @returns el modo de credenciales del cliente ("platform" | "byok"), que decide qué cliente
 *   LLM se usará y a quién se le carga el consumo.
 */
export async function checkClientBalance(
  clientId: string,
  /**
   * H4 T5 — Agente que va a atender, para aplicar SU tope además del del tenant. Lo pasa quien
   * llama porque ahí el agente ya está leído (`runAgent`, `chatWithAgent`): hacer que el gate lo
   * vuelva a leer sería una consulta por mensaje para un dato que el llamador tiene en la mano.
   * Opcional: sin agente sólo se aplica el cupo del tenant, que es lo correcto para el consumo que
   * no viene de un agente (por ejemplo `crm_generate`, que `uso_tokens` registra sin `agente_id`).
   */
  agent?: { id: string; tokenQuotaOverride: number | null } | null
): Promise<string> {
  const client = await prisma.tenant.findUnique({
    where: { id: clientId },
    select: {
      isActive: true,
      // H6 T5.2 — Lo que dice Stripe, separado de lo que decide el propietario.
      subscriptionStatus: true,
      tokensUsedPeriod: true,
      periodStart: true,
      periodAnchorDay: true,
      credentialMode: true,
      // H4 T4 — El cupo ya no es una columna suelta: `tokenBalance` es el override y el plan la
      // regla general.
      tokenBalance: true,
      plan: { select: { tokenQuotaPerAgent: true } },
    },
  });
  // Cliente borrado: se trata como desactivado, no se distingue hacia fuera.
  if (!client) throw new HttpError(402, MSG_SUSPENDIDO);
  // `isActive` es estado administrativo, nunca consecuencia de agotar el cupo (H4 §C.1).
  //
  // H6 §D3 — PRECISIÓN sobre lo que decía este comentario: `isActive` ya NO es "el kill switch del
  // impago". Es SÓLO la decisión humana del propietario, y el impago vive en `subscriptionStatus`, dos
  // líneas más abajo. Mientras fueron el mismo booleano el solapamiento era inofensivo porque nada
  // automático escribía aquí; en el momento en que un webhook pudiera hacerlo, un `invoice.paid`
  // desharía una suspensión manual sin dejar rastro de quién la deshizo.
  //
  // H2: este corte aplica A LOS DOS MODOS, y es deliberado. Traer tu propia clave no es dejar de ser
  // cliente; si byok dispensara de esto, sería la forma de seguir atendido después de que el
  // propietario te apagara.
  if (!client.isActive) throw new HttpError(402, MSG_SUSPENDIDO);
  // H6 T5.2/T5.3 — Corte por impago. ANTES del cupo a propósito: a quien no está pagando, el cupo no
  // es el problema que hay que contarle, y con el mensaje de cuota se pondría a buscar por qué gasta
  // tanto en lugar de mirar su suscripción.
  //
  // `null` NO corta. Es el único fail-open del eje y está acotado a esta columna: los tenants que hay
  // hoy en producción no tienen suscripción, y un corte por impago sin cobro configurado los dejaría
  // mudos a todos el día del despliegue. El fail-closed de H1 no se afloja: `isActive` y el cupo
  // siguen cortando igual.
  //
  // Aplica a los DOS modos por lo mismo que `isActive`: la suscripción paga la plataforma, no los
  // tokens. Quien trae su clave sigue debiendo la cuota.
  if (client.subscriptionStatus && SUBSCRIPTION_BLOCKING_STATUSES.has(client.subscriptionStatus)) {
    throw new HttpError(402, MSG_IMPAGO);
  }
  // H4 T3.2 — Renovación PEREZOSA, antes de decidir. Se hace en los dos modos, no sólo en
  // "platform": el contador tiene que ser coherente con el periodo vigente pase lo que pase, y
  // si sólo se renovara en "platform", un tenant que estuvo en byok volvería con el periodo y el
  // contador de hace meses — y ese contador viejo le cortaría el servicio al primer mensaje.
  const { tokensUsedPeriod, periodStart } = await renewPeriodIfDue(clientId, client);
  // El cupo, en cambio, aplica SÓLO en "platform": es el guardarraíl del gasto LLM del
  // propietario, y en byok ese gasto no existe — lo paga el cliente a su proveedor. Racionar
  // ahí un coste que nadie asume sería cortar el servicio sin ningún motivo económico.
  //
  // H4 T3.3 — Se compara contra el consumo DEL PERIODO, no contra el acumulado de por vida.
  // Con `tokensUsed` el cupo era un saldo de prepago que se agotaba y no volvía: cobrar una
  // suscripción mensual contra un contador que nunca baja es vender algo que deja de funcionar
  // el segundo mes.
  //
  // H4 T4 — El cupo sale del plan salvo override explícito. Contar agentes sólo cuando la
  // respuesta depende de ello: con override el cupo ya está decidido, y cobrar una consulta por
  // mensaje para un dato que no se va a usar sería gasto puro.
  //
  // H7 — Sin plan ya no es un corte: es el cupo por defecto de la plataforma. Un cliente recién dado
  // de alta atiende desde el primer mensaje, sin que nadie le ponga el saldo a mano. Lo que sí sigue
  // cortando es `tokenBalance = 0`, que es un valor puesto a propósito y llega aquí como cupo 0.
  if (client.credentialMode !== "byok") {
    const billableAgents = quotaNeedsAgentCount(client) ? await countBillableAgents(clientId) : 0;
    const { limit } = resolveTokenQuota(client, billableAgents);
    // `limit === null` es "sin tope" y se salta la comparación. No se traduce a Infinity ni a 0:
    // convertirlo a 0 bloquearía justo el caso normal de BYOK-por-plan.
    if (limit !== null && tokensUsedPeriod >= limit) throw new HttpError(402, MSG_CUOTA);

    // H4 T5 — Tope del agente, DESPUÉS del tope del tenant. El orden importa: si el cliente está
    // sin cupo, ese es el hecho que hay que arreglar (y afecta a todos sus agentes); decirle que
    // "este asistente llegó a su límite" mandaría a subir un tope que no cambiaría nada.
    // Sólo se paga la suma cuando hay un tope que comparar.
    if (agent) {
      // H7 — Se pasa el tenant completo, no sólo su plan: con override del tenant no hay defecto por
      // agente, y esa decisión la toma `resolveAgentQuota` con el mismo dato que resuelve el cupo.
      const perAgent = resolveAgentQuota(agent, client);
      if (perAgent.limit !== null) {
        const usedByAgent = await sumAgentPeriodUsage(agent.id, periodStart);
        if (usedByAgent >= perAgent.limit) throw new HttpError(402, MSG_CUOTA_AGENTE);
      }
    }
  }
  return client.credentialMode;
}

/**
 * H4 (aa-planes-y-cuotas, T3.2) — Renovación perezosa del periodo. Devuelve el consumo del
 * periodo VIGENTE, ya renovado si tocaba.
 *
 * Perezosa y no por cron, deliberadamente: un cron que falla el día 1 deja sin servicio a un
 * cliente que paga, y el fallo se descubre por su queja. Aquí la renovación es parte del camino
 * que ya se recorre para decidir, así que no puede llegar tarde: si el periodo venció, el primer
 * mensaje del nuevo periodo lo renueva.
 *
 * Idempotente frente a concurrencia por `updateMany` condicionado al `periodStart` que se leyó
 * (compare-and-set). Dos peticiones simultáneas de un tenant con el periodo vencido intentan
 * renovar las dos; la condición sólo la cumple una. La que pierde NO reintenta ni asume cero:
 * relee, porque entre la renovación ajena y su lectura ya pudo haber consumo, y dar por cero un
 * contador ajeno es abrir un hueco por el que se cuela un mensaje gratis por carrera.
 */
async function renewPeriodIfDue(
  clientId: string,
  snapshot: { periodStart: Date; periodAnchorDay: number; tokensUsedPeriod: number }
): Promise<{ tokensUsedPeriod: number; periodStart: Date }> {
  const { periodStart, renewed } = resolveCurrentPeriod(snapshot, new Date());
  // Caso normal: nada que escribir. El gate no debe costar un UPDATE por mensaje.
  if (!renewed) return { tokensUsedPeriod: snapshot.tokensUsedPeriod, periodStart };

  const { count } = await prisma.tenant.updateMany({
    where: { id: clientId, periodStart: snapshot.periodStart },
    data: { periodStart, tokensUsedPeriod: 0 },
  });
  if (count === 1) return { tokensUsedPeriod: 0, periodStart };

  const fresh = await prisma.tenant.findUnique({
    where: { id: clientId },
    select: { tokensUsedPeriod: true },
  });
  // El `periodStart` es el mismo que calculó quien ganó la carrera: los dos resolvieron el periodo
  // vigente a partir del mismo ancla, así que no hace falta releerlo.
  return { tokensUsedPeriod: fresh?.tokensUsedPeriod ?? 0, periodStart };
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
  opts: {
    isTest?: boolean;
    /**
     * H4 T5 — Agente que atiende, para aplicar también SU tope. Lo pasa el llamador porque ya lo
     * tiene leído; omitirlo aplica sólo el cupo del tenant (comportamiento previo a T5).
     */
    agent?: { id: string; tokenQuotaOverride: number | null } | null;
  } = {}
): Promise<{ meteredTenantId: string | null; credentialMode: string }> {
  if (!tenantId) {
    if (opts.isTest) return { meteredTenantId: null, credentialMode: "platform" };
    throw new HttpError(
      402,
      "Este asistente no está asignado a ningún cliente y no puede usarse. Contacta con el administrador."
    );
  }
  const credentialMode = await checkClientBalance(tenantId, opts.agent);
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
 *  1. Si se incrementan los contadores del tenant. En byok no se incrementan: miden el consumo
 *     contra el cupo, y en byok no hay cupo que consumir. Incrementarlos dejaría a un cliente
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
  credentialMode: string = "platform",
  // T8.2: los valores admiten null porque un contador puede ser "no informado" (p. ej.
  // `cachedTokens` cuando el proveedor no manda `prompt_tokens_details`). Guardar 0 en su lugar
  // convertiría un dato ausente en un dato falso.
  contexto?: Record<string, number | null> | null
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
    // F (aa-agentes-economia-tokens, T6.1) — Desglose de observación: tokens de entrada, cuántos
    // sirvió el proveedor de su caché de prefijo y cuántas vueltas dio el bucle. Es un dato distinto
    // de `tokens`: eso es lo que se le imputa al cliente, esto es lo que le costó al propietario.
    // Sin ambos números no se puede afirmar que el caché funciona, sólo suponerlo.
    // Opcional a propósito: `crm_generate` y cualquier llamador que no mida no cambia de forma.
    ...(contexto ? { contexto } : {}),
  };
  try {
    if (credentialMode === "byok") {
      await prisma.tokenUsage.create({ data: usageData });
      return;
    }
    await prisma.$transaction([
      prisma.tenant.update({
        where: { id: clientId },
        // H4 T3.3 — Los dos contadores suben en la MISMA transacción que ya existía: el de por
        // vida (`tokensUsed`, histórico que nadie reinicia) y el del periodo, que es contra el
        // que corta el gate. Separarlos en dos escrituras permitiría que una fallara y dejaría
        // los contadores discrepando entre sí sin forma de saber cuál es el bueno.
        //
        // Si el periodo rotó entre el gate y este descuento, los tokens caen en el periodo
        // nuevo. Es correcto por convención y el error máximo es una respuesta: la alternativa
        // —volver a resolver el periodo aquí— añadiría una lectura por mensaje para repartir
        // mejor un caso de borde que la reconciliación de T3.4 detecta igual.
        data: {
          tokensUsed: { increment: tokens },
          tokensUsedPeriod: { increment: tokens },
        },
      }),
      prisma.tokenUsage.create({ data: usageData }),
    ]);
  } catch (e) {
    logger.error({ err: e }, "[token-metering] deductTokens:");
  }
}
