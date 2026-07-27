import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { z } from "zod";

/**
 * H3 (aa-agente-ciclo-vida-publicacion) — Ciclo de vida del agente: fuente única de
 * estados, del gate de tráfico y del recuento facturable.
 *
 * El problema que cierra: `Agent.publicKey` se genera en el alta, así que hasta este
 * change crear = publicar = facturable, en el mismo instante y sin que nadie lo
 * decidiera. No se podía probar un agente sin exponerlo, ni apagar uno sin suspender al
 * tenant entero.
 *
 * Criterio de diseño: si el estado no cambia el comportamiento observable, no es un
 * estado, es una etiqueta. Un `status` que nadie comprueba es peor que nada — da falsa
 * sensación de control, y encima factura. De ahí que el gate (`assertAgentServable`) y el
 * recuento (`countBillableAgents`) vivan aquí, junto a la definición de los estados.
 *
 * Corolario de H1 ("lo que no es cobrable, no es servible"):
 *   lo que no está publicado no se sirve, y lo que no se sirve no se factura.
 * Las dos direcciones tienen que cumplirse o el estado miente en una de ellas.
 */

export const AGENT_STATUSES = ["draft", "published", "suspended", "archived"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const agentStatusSchema = z.enum(AGENT_STATUSES);

/**
 * Estados que se facturan. `suspended` SÍ factura: el agente está vendido y sólo está
 * callado por impago; dejar de contarlo premiaría no pagar. Ésa es la razón de que el
 * estado sea un enum de cuatro valores y no un booleano `isPublished`: `draft` y
 * `suspended` silencian el agente de forma idéntica, pero significan lo contrario para la
 * factura, y un booleano obligaría a inferir la causa en otro sitio — exactamente el bug
 * que H4/T1 tuvo que deshacer con `Tenant.isActive`.
 */
export const BILLABLE_STATUSES: readonly AgentStatus[] = ["published", "suspended"];

/** Estados en los que el agente atiende tráfico real. Sólo uno. */
export const SERVABLE_STATUSES: readonly AgentStatus[] = ["published"];

const MSG_NO_PUBLICADO =
  "Este asistente todavía no está publicado. Contacta con el administrador.";
const MSG_ARCHIVADO = "Este asistente ha sido retirado. Contacta con el administrador.";
// Mismo texto que el kill switch de tenant en token-metering.ts: hacia fuera es el mismo
// hecho ("desactivado"), y no hay motivo para que el visitante distinga si el corte viene
// del tenant o del agente.
const MSG_SUSPENDIDO =
  "Este asistente está desactivado temporalmente. Contacta con el administrador.";

export function isServable(status: string): boolean {
  return SERVABLE_STATUSES.includes(status as AgentStatus);
}

/**
 * Gate de publicación. Se invoca en los MISMOS dos puntos donde H1 puso el gate de saldo
 * (`runAgent` y `chatWithAgent`), y siempre ANTES que él: un borrador con el cupo agotado
 * tiene que decir "no publicado", que es lo que hay que arreglar, no "sin cupo", que sería
 * una pista falsa.
 *
 * Excepción `isTest`: la consola de pruebas del operador debe poder hablar con un borrador
 * — el flujo es crear → probar → publicar, y si publicar fuese requisito para probar, el
 * estado no serviría de nada. La exención es ACOTADA a `draft`, igual que la de H1 sólo
 * dispensaba del requisito de tener tenant:
 *   - `suspended` no se exime: la consola no puede ser la vía para seguir atendiendo a un
 *     tenant que dejó de pagar.
 *   - `archived` no se exime: un agente retirado se desarchiva, no se prueba a escondidas.
 *
 * SEGURIDAD: `isTest` sólo se honra con sesión de operador. Quien lo pasa es responsable
 * de resolverlo así (ver `ai.ts`: `Boolean(test) && Boolean(req.user)`), porque `/api/chat`
 * es una ruta pública.
 *
 * @throws HttpError 403 si no está publicado (402 si está suspendido, para que el widget
 *   lo trate igual que el corte por impago de H1/H4).
 */
export function assertAgentServable(
  status: string,
  opts: { isTest?: boolean } = {}
): void {
  if (isServable(status)) return;
  if (status === "draft") {
    if (opts.isTest) return;
    throw new HttpError(403, MSG_NO_PUBLICADO);
  }
  if (status === "suspended") throw new HttpError(402, MSG_SUSPENDIDO);
  if (status === "archived") throw new HttpError(403, MSG_ARCHIVADO);
  // Estado desconocido (dato corrupto o escrito fuera de este módulo): fail-closed.
  // No servir es recuperable; servir por error factura y expone.
  throw new HttpError(403, MSG_NO_PUBLICADO);
}

/**
 * Igual que `assertAgentServable`, pero leyendo el estado por id. Para las vías de servicio
 * que NO pasan por `runAgent` y por tanto no heredan el gate del cuello: reserva de citas,
 * kickoff de leads. Son gasto y compromiso real (una cita en el calendario, un WhatsApp a
 * una persona) sin una sola llamada al LLM, así que "no consume tokens" no las exime.
 *
 * @throws HttpError 404 si el agente no existe; lo que corresponda si no es servible.
 */
export async function assertAgentServableById(
  agentId: string,
  opts: { isTest?: boolean } = {}
): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { status: true },
  });
  if (!agent) throw new HttpError(404, "Agente no encontrado");
  assertAgentServable(agent.status, opts);
}

/**
 * Recuento facturable de un tenant. **Derivado del estado**, nunca un contador
 * materializado en `Tenant`: un contador se desincroniza del hecho que dice contar, que es
 * la misma razón por la que H4 calcula el consumo desde `uso_tokens` en vez de fiarse de
 * un acumulado.
 *
 * Contrato consumido por H4 (`aa-planes-y-cuotas`, T4) para el cobro por agente activo.
 */
export async function countBillableAgents(tenantId: string): Promise<number> {
  return prisma.agent.count({
    where: { tenantId, status: { in: BILLABLE_STATUSES as AgentStatus[] } },
  });
}

/**
 * Aplica una transición de estado y deja rastro, en una sola transacción: sin el evento no
 * se puede responder "¿estuvo publicado en junio?", que es LA pregunta de la factura, y un
 * cambio de estado sin su evento es peor que ninguno de los dos (la fila diría una cosa y
 * el historial otra).
 *
 * Idempotente: si el agente ya está en el estado destino, no escribe nada y no duplica
 * evento. `publishedAt` se sella sólo en la PRIMERA publicación — republicar no reescribe
 * la fecha desde la que se factura.
 *
 * @param actor userId de quien lo hace, o "system" cuando lo pone la plataforma
 *   (suspensión por impago, que escribirá H4/H6).
 * @returns el agente actualizado, o el agente intacto si no hubo transición.
 */
export async function transitionAgentStatus(
  agentId: string,
  to: AgentStatus,
  opts: { actor?: string | null; reason?: string | null } = {}
) {
  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    select: { id: true, status: true, publishedAt: true },
  });

  if (agent.status === to) return { agent, changed: false as const };

  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.agent.update({
      where: { id: agentId },
      data: {
        status: to,
        statusChangedAt: now,
        // Sólo la primera vez. `publishedAt` es el inicio de la historia de cobro, no la
        // fecha de la última vez que se tocó el botón.
        ...(to === "published" && !agent.publishedAt ? { publishedAt: now } : {}),
      },
    }),
    prisma.agentStatusEvent.create({
      data: {
        agentId,
        from: agent.status,
        to,
        actor: opts.actor ?? null,
        reason: opts.reason ?? null,
      },
    }),
  ]);

  return { agent: updated, changed: true as const };
}

/**
 * Precondiciones de publicación.
 *
 * BLOQUEANTES — rompen algo si faltan:
 *   - `tenantId`: sin cliente asignado no hay a quién cobrar, y publicar sin eso es
 *     precisamente el agujero que este change cierra.
 *   - `systemPrompt` no vacío: sin prompt no hay agente.
 *
 * AVISO, no bloqueo — `channel` es `telegram`/`whatsapp` sin conexión de mensajería.
 * La primera versión del diseño lo tenía como bloqueante; el inventario de T0.1 lo tumbó
 * con datos: 3 de los 6 agentes que servían tráfico en producción (DorsIA, CoderAI, Agente
 * EDM San Blas) tienen `channel = "whatsapp"` sin ninguna conexión y funcionan por
 * widget/API. La regla habría rechazado la mitad de los agentes vendidos. Confirma el
 * comentario del propio schema: `channel` es informativo tras el alta. Aun así se avisa: si
 * el cliente compró "atención por WhatsApp" y no está conectado, no recibe lo que compró.
 * Eso se dice, no se impide.
 */
export type PublishPreconditions = {
  blocking: string[];
  warnings: string[];
};

export function checkPublishPreconditions(agent: {
  tenantId: string | null;
  systemPrompt: string | null;
  channel: string;
  channelConnections: { provider: string }[];
}): PublishPreconditions {
  const blocking: string[] = [];
  if (!agent.tenantId) blocking.push("Falta el cliente al que asignar (y cobrar) el agente.");
  if (!agent.systemPrompt?.trim()) blocking.push("Falta el prompt del sistema.");

  const warnings: string[] = [];
  const declaresMessaging = agent.channel === "telegram" || agent.channel === "whatsapp";
  if (declaresMessaging && !agent.channelConnections.some((c) => c.provider === agent.channel)) {
    warnings.push(
      `El canal declarado es ${agent.channel} y no hay conexión activa: el agente atenderá por widget/API, no por ${agent.channel}.`
    );
  }

  return { blocking, warnings };
}
