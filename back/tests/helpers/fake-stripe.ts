/**
 * H6 (aa-stripe-suscripciones, T2.2) — Doble en memoria de `StripeGateway`.
 *
 * No hay cuenta de Stripe (27/07/2026), así que este doble es lo que permite ejecutar de verdad la
 * lógica de siembra y de cobro sin abrir una conexión de red (AC15). No es un mock de llamadas: es una
 * implementación con estado que respeta las reglas del proveedor que el eje depende de.
 *
 * LA REGLA QUE ESTE DOBLE **TIENE** QUE MODELAR: los `Price` de Stripe son INMUTABLES.
 *
 * No existe forma de editar el importe de un `Price` ni aquí ni en Stripe. Un doble permisivo que
 * dejara mutar `amount` haría pasar el test de subida de tarifa (E2) con una premisa falsa: el test
 * verde afirmaría que la suscripción firmada sigue en 99 € cuando en realidad la implementación real
 * ni podría haber hecho lo que el doble le permitió. Un test así es peor que no tenerlo.
 *
 * `calls` existe para poder afirmar la idempotencia (AC2) por AUSENCIA: en la segunda pasada de
 * `stripe:sync` sin cambios en el catálogo, `createRecurringPrice` y `archivePrice` deben quedarse a
 * cero. La idempotencia no se puede comprobar mirando sólo el estado final — dos ejecuciones que crean
 * y archivan dejarían el mismo estado que una que no toca nada.
 */
import type {
  CheckoutInput,
  CheckoutSession,
  EnsureCustomerInput,
  EnsureProductInput,
  RecurringPriceInput,
  StripeGateway,
  StripeMode,
} from "@/lib/stripe/gateway";
import { productIdFor } from "@/lib/stripe/gateway";

export interface FakePrice {
  id: string;
  productId: string;
  amount: number;
  currency: string;
  interval: "month";
  active: boolean;
}

export interface FakeProduct {
  id: string;
  name: string;
  description: string;
}

export interface FakeSubscription {
  id: string;
  priceId: string;
  quantity: number;
}

export interface FakeCustomer {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
}

export class FakeStripeGateway implements StripeGateway {
  readonly mode: StripeMode;

  readonly products = new Map<string, FakeProduct>();
  readonly prices: FakePrice[] = [];
  readonly subscriptions: FakeSubscription[] = [];
  readonly customers = new Map<string, FakeCustomer>();
  readonly checkouts: (CheckoutInput & { id: string })[] = [];

  readonly calls = {
    ensureProduct: 0,
    createProduct: 0,
    updateProduct: 0,
    findPrice: 0,
    createPrice: 0,
    archivePrice: 0,
    countSubscriptions: 0,
    ensureCustomer: 0,
    createCustomer: 0,
    createCheckout: 0,
  };

  private seq = 0;

  constructor(mode: StripeMode = "test") {
    this.mode = mode;
  }

  async ensureProduct({ serviceId, name, description }: EnsureProductInput): Promise<string> {
    this.calls.ensureProduct += 1;
    const id = productIdFor(serviceId);
    const existing = this.products.get(id);
    if (!existing) {
      this.calls.createProduct += 1;
      this.products.set(id, { id, name, description });
      return id;
    }
    // Nombre y descripción son texto comercial y siguen al catálogo. El importe NO está aquí.
    if (existing.name !== name || existing.description !== description) {
      this.calls.updateProduct += 1;
      this.products.set(id, { id, name, description });
    }
    return id;
  }

  async findActiveRecurringPrice({
    productId,
    amount,
    currency,
  }: RecurringPriceInput): Promise<string | null> {
    this.calls.findPrice += 1;
    const match = this.prices.find(
      (p) =>
        p.active &&
        p.productId === productId &&
        p.amount === amount &&
        p.currency === currency &&
        p.interval === "month"
    );
    return match?.id ?? null;
  }

  async createRecurringPrice({
    productId,
    amount,
    currency,
  }: RecurringPriceInput): Promise<string> {
    this.calls.createPrice += 1;
    if (!this.products.has(productId)) {
      // En Stripe un `Price` sin producto es un error. Que el doble lo sea también evita que un test
      // pase con un orden de llamadas que la implementación real rechazaría.
      throw new Error(`FakeStripe: producto inexistente ${productId}`);
    }
    const id = `price_${++this.seq}`;
    this.prices.push({ id, productId, amount, currency, interval: "month", active: true });
    return id;
  }

  async archivePrice(priceId: string): Promise<void> {
    this.calls.archivePrice += 1;
    const price = this.prices.find((p) => p.id === priceId);
    if (!price) throw new Error(`FakeStripe: precio inexistente ${priceId}`);
    // Archivar es desactivar. El importe sigue siendo el que era: las suscripciones que apuntan a
    // este `Price` continúan cobrándose por él.
    price.active = false;
  }

  async ensureCustomer({
    tenantId,
    name,
    email,
    existingCustomerId,
  }: EnsureCustomerInput): Promise<string> {
    this.calls.ensureCustomer += 1;
    if (existingCustomerId && this.customers.has(existingCustomerId)) return existingCustomerId;
    this.calls.createCustomer += 1;
    const id = `cus_${++this.seq}`;
    this.customers.set(id, { id, tenantId, name, email: email ?? null });
    return id;
  }

  async createSubscriptionCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    this.calls.createCheckout += 1;
    if (!this.customers.has(input.customerId)) {
      throw new Error(`FakeStripe: cliente inexistente ${input.customerId}`);
    }
    const price = this.prices.find((p) => p.id === input.priceId);
    if (!price) throw new Error(`FakeStripe: precio inexistente ${input.priceId}`);
    if (!price.active) {
      // Stripe rechaza un checkout sobre un `Price` archivado. Que el doble también lo haga evita que
      // un test dé por bueno un alta a una tarifa retirada.
      throw new Error(`FakeStripe: precio archivado ${input.priceId}`);
    }
    const id = `cs_${++this.seq}`;
    this.checkouts.push({ ...input, id });
    return { id, url: `https://checkout.stripe.test/${id}` };
  }

  /** Última sesión creada. Lo que se le pasó a Stripe es lo que hay que auditar en los tests de §D7. */
  lastCheckout(): (CheckoutInput & { id: string }) | undefined {
    return this.checkouts[this.checkouts.length - 1];
  }

  /** Importe total que cobraría una sesión: `amount × quantity`. La cifra que ve el cliente. */
  checkoutTotal(sessionId: string): number | undefined {
    const session = this.checkouts.find((c) => c.id === sessionId);
    if (!session) return undefined;
    const price = this.prices.find((p) => p.id === session.priceId);
    return price ? price.amount * session.quantity : undefined;
  }

  async countSubscriptionsOnPrice(priceId: string): Promise<number> {
    this.calls.countSubscriptions += 1;
    return this.subscriptions.filter((s) => s.priceId === priceId).length;
  }

  // ---- utilidades de test (no forman parte del puerto) ----

  /** Simula un cliente que ya firmó a la tarifa `priceId`. */
  addSubscription(priceId: string, quantity = 1): FakeSubscription {
    const sub = { id: `sub_${++this.seq}`, priceId, quantity };
    this.subscriptions.push(sub);
    return sub;
  }

  /** Importe que se le cobra hoy a una suscripción, leyendo su `Price`. */
  amountChargedTo(subscriptionId: string): number | null {
    const sub = this.subscriptions.find((s) => s.id === subscriptionId);
    if (!sub) return null;
    return this.prices.find((p) => p.id === sub.priceId)?.amount ?? null;
  }

  pricesOfProduct(productId: string): FakePrice[] {
    return this.prices.filter((p) => p.productId === productId);
  }

  resetCalls(): void {
    for (const key of Object.keys(this.calls) as (keyof typeof this.calls)[]) {
      this.calls[key] = 0;
    }
  }
}
