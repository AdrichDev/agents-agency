/**
 * H6 (aa-stripe-suscripciones, T3.2) — Webhook de Stripe.
 *
 * MONTADO FUERA DE `/api`, Y NO POR COMODIDAD (design §D6).
 *
 * Todo `/api` pasa por `apiLimiter`, por el gate de token de Supabase y por `clientScopeGate`
 * (`index.ts:113-198`). Stripe no tiene usuario, no manda Bearer y no tiene por qué compartir el
 * limitador de la API de los clientes: un pico de reintentos de Stripe no debe consumir el presupuesto
 * de nadie, ni al contrario. El repo ya tiene este patrón para tráfico server-to-server:
 * `/service/operator` y `/service/telegram`.
 *
 * Lo que autentica aquí es la firma HMAC sobre `req.rawBody` (`webhook-signature.ts`). No hay token, no
 * hay allowlist de IPs, no hay secreto en la URL: sólo la firma.
 *
 * SIEMPRE 200 CUANDO LA FIRMA ES VÁLIDA — incluso si el evento no nos interesa o si su cliente es
 * desconocido. Un 4xx le dice a Stripe "reintenta", y reintentar durante días un evento que nunca
 * vamos a procesar sólo genera ruido y acaba desactivando el endpoint. El 400 se reserva para lo único
 * que de verdad es un error del emisor: una firma que no valida.
 */
import { Router, type Request, type Response } from "express";
import { logger } from "@/lib/logger";
import {
  markStripeEventFailed,
  markStripeEventProcessed,
  registerStripeEvent,
} from "@/lib/stripe/event-log";
import { handleStripeEvent, type StripeWebhookEvent } from "@/lib/stripe/handlers";
import { STRIPE_SIGNATURE_HEADER, verifyStripeSignature } from "@/lib/stripe/webhook-signature";

export const serviceStripeRouter = Router();

/**
 * POST /service/stripe/webhook
 */
export async function stripeWebhookHandler(req: Request, res: Response) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Sin secreto no se puede verificar NADA. Se rechaza en lugar de aceptar a ciegas: aceptar sería
    // un endpoint abierto capaz de marcar morosos como pagados.
    logger.error("[stripe] STRIPE_WEBHOOK_SECRET no configurada; webhook rechazado");
    return res.status(500).json({ error: "webhook no configurado" });
  }

  const verdict = verifyStripeSignature({
    rawBody: req.rawBody,
    header: req.headers[STRIPE_SIGNATURE_HEADER],
    secret,
  });

  if (!verdict.ok) {
    // El motivo va al log del servidor, no a la respuesta: distinguir "timestamp fuera de ventana" de
    // "HMAC incorrecto" le daría un oráculo a quien esté probando firmas.
    logger.warn({ reason: verdict.reason }, "[stripe] firma de webhook inválida");
    return res.status(400).json({ error: "firma inválida" });
  }

  // Se parsea de `rawBody`, los mismos bytes que se acaban de firmar. Usar `req.body` funcionaría
  // —express lo parseó de ese buffer— pero deja abierta la duda de si algún middleware lo mutó por el
  // camino, y en un endpoint de cobro esa duda no compensa.
  let event: StripeWebhookEvent;
  try {
    event = JSON.parse(req.rawBody!.toString("utf8"));
  } catch {
    logger.warn("[stripe] cuerpo firmado pero no es JSON válido");
    return res.status(400).json({ error: "cuerpo inválido" });
  }

  if (typeof event?.id !== "string" || typeof event?.type !== "string") {
    return res.status(400).json({ error: "evento sin id o sin tipo" });
  }

  // Registro ANTES de procesar (design §D5). El unique de la tabla es lo que excluye los duplicados.
  const outcome = await registerStripeEvent({ id: event.id, type: event.type });
  if (!outcome.process) {
    logger.info({ eventId: event.id, type: event.type }, "[stripe] evento ya procesado, descartado");
    return res.json({ received: true, duplicate: true });
  }

  try {
    const result = await handleStripeEvent(event);
    await markStripeEventProcessed(event.id);

    if (result.handled) {
      logger.info(
        { eventId: event.id, type: event.type, tenantId: result.tenantId, detail: result.detail },
        "[stripe] evento aplicado"
      );
    } else {
      // Ignorado a conciencia: queda marcado como procesado para que Stripe no lo reintente.
      logger.info(
        { eventId: event.id, type: event.type, reason: result.reason },
        "[stripe] evento ignorado"
      );
    }
    return res.json({ received: true, handled: result.handled });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markStripeEventFailed(event.id, message);
    logger.error({ eventId: event.id, type: event.type, err: message }, "[stripe] fallo al procesar");
    // 500 a propósito: aquí SÍ queremos que Stripe reintente. El evento queda con `processedAt = null`,
    // que es exactamente el estado reintentable.
    return res.status(500).json({ error: "fallo al procesar el evento" });
  }
}

serviceStripeRouter.post("/webhook", stripeWebhookHandler);
