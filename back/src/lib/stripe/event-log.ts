/**
 * H6 (aa-stripe-suscripciones, T3.3) — Idempotencia del webhook por `event.id`.
 *
 * EL ORDEN IMPORTA Y ES AL CONTRARIO DE LO QUE PARECE NATURAL (design §D5).
 *
 * Se INSERTA la fila ANTES de procesar, no después. Lo natural sería "¿ya existe? → si no, procesa y
 * registra", y está mal: entre la consulta y el registro hay una ventana en la que dos entregas del
 * mismo evento pasan las dos la comprobación y las dos procesan. La PRIMARY KEY de `stripe_evento` es
 * la única primitiva de exclusión disponible, y para que excluya hay que insertar primero y dejar que
 * la base de datos decida quién gana.
 *
 * `processedAt` distingue tres estados, no dos:
 *   - fila inexistente        → nunca visto        → procesar
 *   - fila con `processedAt`  → terminado          → descartar (200, sin efecto)
 *   - fila sin `processedAt`  → visto, sin acabar  → REINTENTAR
 *
 * El tercero es el que suele faltar. Sin él, el primer fallo transitorio —una caída de red a mitad—
 * dejaría el evento registrado para siempre y su reentrega se descartaría como duplicado: el cobro se
 * perdería en silencio, que es el peor final posible.
 *
 * VENTANA RESIDUAL, declarada a propósito. Dos entregas CONCURRENTES del mismo evento aún sin procesar
 * pueden ambas procesar: la segunda choca con el unique, ve `processedAt = null` y concluye —
 * correctamente, según la regla de reintento— que debe procesar. Es aceptable porque los manejadores
 * de T4 son idempotentes en efecto: escriben un estado (`subscriptionStatus = "active"`), no
 * incrementan nada, y la renovación de periodo la gobierna `billing-period.ts`, que sólo renueva si
 * toca. Cerrarla del todo exigiría un claim con `FOR UPDATE` sobre la fila; queda anotado en el change
 * y no se hace aquí porque cambiaría la forma del módulo por un caso que los reintentos espaciados de
 * Stripe no producen.
 */
import { prisma } from "@/lib/db";

export interface StripeEventRef {
  id: string;
  type: string;
}

export type RegisterOutcome =
  /** Primera vez que se ve: procesar. */
  | { process: true; retry: false }
  /** Ya visto pero sin terminar: procesar otra vez. */
  | { process: true; retry: true }
  /** Ya terminado: descartar sin efecto. */
  | { process: false; retry: false };

/**
 * Registra el evento y dice si hay que procesarlo. Llamar SIEMPRE antes de procesar.
 */
export async function registerStripeEvent(event: StripeEventRef): Promise<RegisterOutcome> {
  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
    return { process: true, retry: false };
  } catch (err) {
    if ((err as { code?: string }).code !== "P2002") throw err;

    const existing = await prisma.stripeEvent.findUnique({ where: { id: event.id } });
    // Si la fila desapareció entre el choque y esta lectura (borrado manual, purga), se trata como
    // reintento: procesar es recuperable, ignorar un cobro no.
    if (existing?.processedAt) return { process: false, retry: false };
    return { process: true, retry: true };
  }
}

/** Cierra el evento como terminado y borra el error de un intento anterior. */
export async function markStripeEventProcessed(eventId: string): Promise<void> {
  await prisma.stripeEvent.update({
    where: { id: eventId },
    data: { processedAt: new Date(), error: null },
  });
}

/**
 * Deja el evento reintentable y guarda el motivo.
 *
 * `processedAt` se fuerza a `null` explícitamente en vez de simplemente no tocarlo: si el fallo ocurre
 * en un reintento de un evento que ya se había marcado como terminado, dejarlo con fecha lo haría
 * indescartable de nuevo... y al contrario, dejarlo con fecha lo daría por bueno habiendo fallado.
 */
export async function markStripeEventFailed(eventId: string, message: string): Promise<void> {
  await prisma.stripeEvent.update({
    where: { id: eventId },
    // Truncado: el `error` es para diagnosticar, no para archivar un stacktrace entero.
    data: { processedAt: null, error: message.slice(0, 500) },
  });
}
