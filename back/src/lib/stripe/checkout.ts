/**
 * H6 (aa-stripe-suscripciones, T6) — Alta de suscripción: el importe lo pone el servidor.
 *
 * LA REGLA (design §D7): esta función recibe `tenantId` y `serviceId`. **Nada más.** No hay parámetro
 * de importe, ni de `priceId`, ni de `quantity`, así que no hay nada que validar "más adentro": el
 * ataque de suscribirse a un céntimo no es que se rechace, es que no tiene por dónde entrar. Un
 * endpoint que aceptara `amount` y lo comprobara contra el catálogo sería una comprobación que alguien
 * puede olvidar el día que refactorice; una firma sin el campo, no.
 *
 * De dónde sale cada cosa:
 *   - importe   → `StripePriceMap`, que a su vez lo sembró `sync-catalog.ts` desde el catálogo. El
 *                 precio sigue viviendo en un solo sitio (`service-catalog.json`).
 *   - cantidad  → `countBillableAgents(tenantId)`. Se cobra por agente activo, así que la cantidad es
 *                 un hecho del servidor y no una preferencia del navegador.
 *
 * Está separado de la ruta a propósito, igual que `sync-catalog.ts` lo está de su CLI: así los tests
 * ejercitan la lógica de verdad en lugar de un handler de express con cinco dobles alrededor.
 */
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { SERVICE_CATALOG } from "@/lib/service-catalog";
import { countBillableAgents } from "@/lib/quota";
import {
  getStripeGateway,
  type CheckoutSession,
  type StripeGateway,
  type StripeMode,
} from "@/lib/stripe/gateway";
import { isSubscriptionService } from "@/lib/stripe/sync-catalog";

export interface StartCheckoutInput {
  tenantId: string;
  serviceId: string;
  /** Inyectables para los tests; en producción salen de `getStripeGateway()` y del entorno. */
  gateway?: StripeGateway;
  frontUrl?: string;
}

export interface StartCheckoutResult extends CheckoutSession {
  serviceId: string;
  quantity: number;
  priceId: string;
  mode: StripeMode;
}

export function frontUrlFor(explicit?: string): string {
  return (explicit ?? process.env.FRONT_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function startSubscriptionCheckout({
  tenantId,
  serviceId,
  gateway = getStripeGateway(),
  frontUrl,
}: StartCheckoutInput): Promise<StartCheckoutResult> {
  const entry = SERVICE_CATALOG.find((s) => s.id === serviceId);
  if (!entry) throw new HttpError(400, `Servicio desconocido: ${serviceId}`);
  if (!isSubscriptionService(entry)) {
    // Los packs de tokens y las horas no son suscripciones. Dejar pasar uno crearía una suscripción
    // mensual a algo que se vende una vez.
    throw new HttpError(400, `El servicio "${entry.name}" no es una suscripción mensual`);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, email: true, stripeCustomerId: true },
  });
  if (!tenant) throw new HttpError(404, "Cliente no encontrado");

  const mapped = await prisma.stripePriceMap.findUnique({
    where: { serviceId_mode: { serviceId, mode: gateway.mode } },
    select: { priceId: true },
  });
  if (!mapped) {
    // Fail-closed, y con un mensaje que dice qué hacer. La alternativa —crear el `Price` al vuelo—
    // convertiría cada alta en una posible siembra silenciosa de tarifas en Stripe.
    throw new HttpError(
      409,
      `El servicio "${serviceId}" no está sincronizado con Stripe (${gateway.mode}). Ejecuta "npm run stripe:sync".`
    );
  }

  const quantity = await countBillableAgents(tenantId);
  if (quantity < 1) {
    // Cobrar por cero agentes daría una suscripción de 0 €, que Stripe acepta y que después habría que
    // corregir a mano cuando el cliente publicara su primer agente.
    throw new HttpError(
      409,
      "El cliente no tiene ningún agente facturable. Publica al menos uno antes de dar de alta la suscripción."
    );
  }

  const customerId = await gateway.ensureCustomer({
    tenantId,
    name: tenant.name,
    email: tenant.email,
    existingCustomerId: tenant.stripeCustomerId,
  });

  // Se guarda ANTES de abrir la sesión. Si el cliente abandona el checkout, el `Customer` ya existe en
  // Stripe: sin guardarlo, el siguiente intento crearía otro y el historial del cliente quedaría
  // partido en dos. Y si es el mismo que ya había, el update es un no-op.
  if (customerId !== tenant.stripeCustomerId) {
    await prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customerId } });
  }

  const base = frontUrlFor(frontUrl);
  const session = await gateway.createSubscriptionCheckout({
    customerId,
    priceId: mapped.priceId,
    quantity,
    tenantId,
    serviceId,
    successUrl: `${base}/clientes/${tenantId}?suscripcion=ok`,
    cancelUrl: `${base}/clientes/${tenantId}?suscripcion=cancelada`,
  });

  return { ...session, serviceId, quantity, priceId: mapped.priceId, mode: gateway.mode };
}
