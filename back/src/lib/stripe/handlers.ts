/**
 * H6 (aa-stripe-suscripciones, T4) — Manejadores de los eventos de Stripe.
 *
 * LA REGLA QUE GOBIERNA TODO ESTE FICHERO (design §D3):
 *
 *   NINGÚN MANEJADOR ESCRIBE `Tenant.isActive`. NUNCA.
 *
 * `isActive` es la decisión del propietario: "a este cliente lo he apagado yo". `subscriptionStatus`
 * es lo que dice Stripe. Si un webhook pudiera escribir `isActive`, bastaría un `invoice.paid` para
 * deshacer una suspensión manual —sin rastro de quién la deshizo— o un `payment_failed` para
 * contradecir una reactivación que una persona decidió a mano. Son dos hechos distintos y viven en dos
 * columnas distintas; el corte se hace con un OR en el gate (T5).
 *
 * Segunda regla: **un webhook no da de alta clientes.** Un evento de un `customer` que no está en la
 * base de datos se registra y se ignora. Crear un tenant desde un webhook significaría que cualquiera
 * capaz de provocar un evento en la cuenta de Stripe puede crear entidades en AA.
 *
 * Tercera: **el estado se guarda tal como lo dice Stripe.** No hay traducción a un enum propio. Lo que
 * corta el servicio lo decide una sola lista (`SUBSCRIPTION_BLOCKING_STATUSES`, T5) y no un mapeo
 * disperso por los manejadores. Así `incomplete` o `paused` quedan registrados de forma fiel sin que
 * nadie tenga que decidir aquí, de pasada, si merecen cortar.
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/** Forma mínima de un evento. No se usa el tipo del SDK: los fixtures de test son objetos a mano. */
export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export type HandlerResult =
  | { handled: true; tenantId: string; detail: string }
  /** Evento legítimo que no nos toca (o cuyo cliente no conocemos). 200 y a otra cosa. */
  | { handled: false; reason: string };

/**
 * Tipos que este eje procesa. Cualquier otro se registra y se ignora con 200 (T4.4): un 4xx haría que
 * Stripe reintentara indefinidamente algo que nunca vamos a procesar.
 */
export const HANDLED_EVENT_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

export async function handleStripeEvent(event: StripeWebhookEvent): Promise<HandlerResult> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return handleSubscriptionEvent(event);
    case "invoice.paid":
      return handleInvoiceEvent(event, "active");
    case "invoice.payment_failed":
      return handleInvoiceEvent(event, "past_due");
    default:
      // `checkout.session.completed` de `mode: "payment"` cae aquí a propósito: la implantación se
      // factura con el módulo de facturas de AA y no pasa por Stripe (design §D9, AC17). Ese cobro no
      // es de aquí, y no serlo no es un error.
      return { handled: false, reason: `tipo no manejado: ${event.type}` };
  }
}

/** `customer.subscription.*` — estado, id de suscripción y ancla del periodo. */
async function handleSubscriptionEvent(event: StripeWebhookEvent): Promise<HandlerResult> {
  const sub = event.data.object;
  const subscriptionId = asString(sub.id);
  const customerId = asString(sub.customer);
  const status =
    event.type === "customer.subscription.deleted" ? "canceled" : asString(sub.status);

  if (!subscriptionId || !status) return { handled: false, reason: "suscripción sin id o sin estado" };

  const tenant = await resolveTenant({
    metadataTenantId: metadataTenantId(sub),
    subscriptionId,
    customerId,
  });
  if (!tenant) return { handled: false, reason: `cliente de Stripe desconocido: ${customerId ?? "?"}` };

  const data: Record<string, unknown> = {
    subscriptionStatus: status,
    stripeSubscriptionId: subscriptionId,
  };
  if (customerId) data.stripeCustomerId = customerId;

  // Ancla del periodo desde Stripe (design §D4), para que el cupo se reinicie el mismo día que se
  // cobra. Se omite en `.deleted`: una suscripción cancelada no debe mover el ciclo de cupo del
  // cliente, que sigue existiendo aunque deje de pagar.
  if (event.type !== "customer.subscription.deleted") {
    const anchor = readAnchorSeconds(sub);
    // Día UTC del ancla. No pasa por `normalizeAnchorDay` porque esa función es un fail-safe para
    // anclas ya guardadas y posiblemente corruptas; un `getUTCDate()` es 1-31 por construcción.
    if (anchor !== null) data.periodAnchorDay = new Date(anchor * 1000).getUTCDate();
    const periodStart = readPeriodStartSeconds(sub);
    if (periodStart !== null) {
      // Alinea el periodo en curso con el de Stripe. Reinicia `tokensUsedPeriod` por la vía normal:
      // es un periodo nuevo, no un efecto colateral.
      data.periodStart = new Date(periodStart * 1000);
      data.tokensUsedPeriod = 0;
    }
  }

  await prisma.tenant.update({ where: { id: tenant.id }, data });
  return { handled: true, tenantId: tenant.id, detail: `estado=${status}` };
}

/** `invoice.paid` / `invoice.payment_failed` — sólo el estado de suscripción. */
async function handleInvoiceEvent(
  event: StripeWebhookEvent,
  status: "active" | "past_due"
): Promise<HandlerResult> {
  const invoice = event.data.object;
  const customerId = asString(invoice.customer);
  const subscriptionId = readInvoiceSubscriptionId(invoice);

  const tenant = await resolveTenant({
    metadataTenantId: metadataTenantId(invoice),
    subscriptionId,
    customerId,
  });
  if (!tenant) return { handled: false, reason: `cliente de Stripe desconocido: ${customerId ?? "?"}` };

  // Sólo `subscriptionStatus`. `isActive` no se toca aquí ni en ningún otro sitio de este fichero.
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { subscriptionStatus: status },
  });
  return { handled: true, tenantId: tenant.id, detail: `estado=${status}` };
}

/**
 * Encuentra el tenant del evento. Nunca lo crea (T4.5).
 *
 * Orden: metadatos → id de suscripción → id de cliente. Los metadatos van primero porque los pone AA
 * al abrir el checkout y son el único vínculo que existe ANTES de que la suscripción tenga id guardado.
 */
async function resolveTenant(keys: {
  metadataTenantId: string | null;
  subscriptionId: string | null;
  customerId: string | null;
}): Promise<{ id: string } | null> {
  if (keys.metadataTenantId) {
    const byMeta = await prisma.tenant.findUnique({
      where: { id: keys.metadataTenantId },
      select: { id: true },
    });
    if (byMeta) return byMeta;
    // Metadato presente pero inexistente: sospechoso, se registra y se sigue probando por ids.
    logger.warn({ tenantId: keys.metadataTenantId }, "[stripe] metadata.tenantId no existe");
  }
  if (keys.subscriptionId) {
    const bySub = await prisma.tenant.findUnique({
      where: { stripeSubscriptionId: keys.subscriptionId },
      select: { id: true },
    });
    if (bySub) return bySub;
  }
  if (keys.customerId) {
    const byCustomer = await prisma.tenant.findUnique({
      where: { stripeCustomerId: keys.customerId },
      select: { id: true },
    });
    if (byCustomer) return byCustomer;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lectura del payload. Defensiva a propósito: sin cuenta de Stripe no hay un
// payload real contra el que estrellarse, así que un campo ausente tiene que
// degradar (no escribir esa parte) y no lanzar.
// ---------------------------------------------------------------------------

/**
 * Ancla del ciclo de facturación, en segundos unix.
 *
 * `billing_cycle_anchor` y NO `current_period_start`: en la API `2026-06-24.dahlia` el objeto
 * `Subscription` **ya no tiene** `current_period_start` (migró a `SubscriptionItem`), y además
 * `billing_cycle_anchor` es el campo cuya semántica es exactamente la de esta columna — "el punto de
 * referencia que fija el día de mes de las facturas siguientes".
 */
export function readAnchorSeconds(sub: Record<string, unknown>): number | null {
  const anchor = asNumber(sub.billing_cycle_anchor);
  if (anchor !== null) return anchor;
  // Suscripciones antiguas o payloads recortados: `start_date` sirve de sustituto razonable.
  return asNumber(sub.start_date);
}

/**
 * Inicio del periodo en curso, en segundos unix, leído de los ITEMS.
 *
 * Se toma el MÍNIMO de los items en lugar del primero: una suscripción de AA tiene un solo item
 * (un `Price` × `quantity`), pero depender de ese supuesto haría que el día que hubiera dos el ancla
 * se tomara del item que Stripe pusiera antes en la lista, que es arbitrario.
 */
export function readPeriodStartSeconds(sub: Record<string, unknown>): number | null {
  const items = (sub.items as { data?: unknown[] } | undefined)?.data;
  if (!Array.isArray(items) || items.length === 0) return null;

  const starts = items
    .map((item) => asNumber((item as Record<string, unknown>).current_period_start))
    .filter((v): v is number => v !== null);
  return starts.length > 0 ? Math.min(...starts) : null;
}

/** En `dahlia` la factura referencia la suscripción por `parent.subscription_details`. */
function readInvoiceSubscriptionId(invoice: Record<string, unknown>): string | null {
  const direct = asString(invoice.subscription);
  if (direct) return direct;
  const parent = invoice.parent as { subscription_details?: { subscription?: unknown } } | undefined;
  return asString(parent?.subscription_details?.subscription);
}

function metadataTenantId(obj: Record<string, unknown>): string | null {
  const metadata = obj.metadata as Record<string, unknown> | undefined;
  return asString(metadata?.tenantId);
}

/** Acepta el id suelto o el objeto expandido (`customer` puede venir de las dos formas). */
function asString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "object" && value !== null) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
