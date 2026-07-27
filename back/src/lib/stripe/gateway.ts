/**
 * H6 (aa-stripe-suscripciones, T2.1) — Puerto `StripeGateway` y su implementación real.
 *
 * POR QUÉ HAY UN PUERTO Y NO SE LLAMA AL SDK DIRECTAMENTE (design §D8)
 *
 * No hay cuenta de Stripe todavía, así que todo lo que se apoye en el SDK no se puede ejecutar ni una
 * vez antes de desplegar. Un puerto estrecho —cinco métodos, sólo lo que el eje usa— permite que la
 * lógica de siembra y de cobro se ejecute de verdad en los tests contra un doble en memoria, y deja
 * el SDK como el único trozo no ejercitado. Sustituir el SDK por otra cosa sería un cambio de
 * implementación, no de spec.
 *
 * El puerto NO expone objetos de Stripe: devuelve ids y números. Si filtrase tipos del SDK, el doble
 * de test tendría que construir objetos completos de Stripe y el "doble" pasaría a ser una segunda
 * implementación del proveedor — que es justo lo que no se quiere mantener.
 */
import Stripe from "stripe";

/**
 * Entorno de Stripe. NO viene de una variable propia: se deriva del prefijo de la clave secreta.
 *
 * Una `STRIPE_MODE` independiente podría contradecir a la clave, y la contradicción sería silenciosa
 * y cara: con `STRIPE_MODE=test` y una clave `sk_live_`, `stripe:sync` escribiría ids de PRODUCCIÓN
 * en la fila `mode: "test"` de `StripePriceMap`. Derivándolo de la clave, esa incoherencia no se
 * puede expresar.
 */
export type StripeMode = "test" | "live";

export interface EnsureProductInput {
  /** `id` del catálogo. Es también `Plan.codigo` (design §D2). */
  serviceId: string;
  name: string;
  description: string;
}

export interface RecurringPriceInput {
  productId: string;
  /** Céntimos. Sale del catálogo, nunca de un literal (AC1). */
  amount: number;
  currency: string;
}

/**
 * Lo único que este eje necesita de Stripe para sembrar el catálogo.
 *
 * Ojo con lo que NO hay aquí: no existe `updatePriceAmount`. Los `Price` de Stripe son **inmutables**
 * y añadir ese método sería mentirle al doble de test y al que lea esto en seis meses. Subir una
 * tarifa crea un `Price` nuevo y archiva el viejo; las suscripciones ya firmadas se quedan en el
 * viejo hasta que alguien decida migrarlas, que es una decisión comercial y no un efecto de editar
 * un JSON.
 */
export interface StripeGateway {
  readonly mode: StripeMode;

  /** Idempotente por construcción: el `id` del `Product` es determinista (`aa_<serviceId>`). */
  ensureProduct(input: EnsureProductInput): Promise<string>;

  /** `priceId` del `Price` recurrente ACTIVO con ese importe exacto, o `null` si no existe. */
  findActiveRecurringPrice(input: RecurringPriceInput): Promise<string | null>;

  createRecurringPrice(input: RecurringPriceInput): Promise<string>;

  /** Un `Price` no se borra ni se edita: se desactiva. */
  archivePrice(priceId: string): Promise<void>;

  /**
   * Cuántas suscripciones siguen apuntando a un `Price`. Se consulta ANTES de archivarlo para poder
   * decir en voz alta a cuántos clientes deja en la tarifa vieja una subida de precio (AC3).
   */
  countSubscriptionsOnPrice(priceId: string): Promise<number>;

  /** Garantiza el `Customer` del tenant y devuelve su id. Idempotente si se le pasa uno existente. */
  ensureCustomer(input: EnsureCustomerInput): Promise<string>;

  /**
   * Sesión de Checkout para una suscripción. Devuelve id y URL.
   *
   * Fíjate en lo que NO recibe: ningún importe. Sólo un `priceId` que el servidor resolvió del mapa y
   * una `quantity` que el servidor contó. Es la firma la que impide el ataque de §D7, no una validación
   * más adentro: aquí no hay ningún parámetro por el que colar un céntimo.
   */
  createSubscriptionCheckout(input: CheckoutInput): Promise<CheckoutSession>;
}

export interface EnsureCustomerInput {
  /** Id de tenant de AA. Va a `metadata` para que el webhook resuelva sin depender de los ids. */
  tenantId: string;
  name: string;
  email?: string | null;
  /** Si el tenant ya tiene uno guardado se reutiliza: dos `Customer` por cliente parten su historial. */
  existingCustomerId?: string | null;
}

export interface CheckoutInput {
  customerId: string;
  priceId: string;
  /** Agentes facturables, contados en el servidor (§D7). */
  quantity: number;
  tenantId: string;
  serviceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

/**
 * `Product.id` determinista a partir del servicio del catálogo.
 *
 * Con id fijo, "garantizar el producto" es un `retrieve` y, si no está, un `create`. Sin él haría
 * falta buscar por nombre —que es texto comercial y cambia— o listar el catálogo entero en cada
 * ejecución. El prefijo `aa_` acota el espacio de nombres dentro de una cuenta que algún día podría
 * tener productos de otra cosa.
 */
export function productIdFor(serviceId: string): string {
  return `aa_${serviceId}`;
}

/** Deriva el entorno del prefijo de la clave. Cualquier otro prefijo es un error de configuración. */
export function resolveStripeMode(secretKey: string): StripeMode {
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) return "live";
  if (secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")) return "test";
  throw new Error(
    "STRIPE_SECRET_KEY no parece una clave de Stripe (se esperaba prefijo sk_test_ / sk_live_)"
  );
}

/** Implementación real. El único trozo del eje que no se ejercita en los tests (design §D8). */
export class RealStripeGateway implements StripeGateway {
  readonly mode: StripeMode;
  private readonly stripe: Stripe;

  constructor(secretKey: string) {
    this.mode = resolveStripeMode(secretKey);
    // Sin `apiVersion` explícita a propósito: el SDK usa la versión con la que se generaron SUS tipos.
    // Fijar aquí una cadena distinta compilaría y luego devolvería objetos con otra forma que la que
    // los tipos prometen — un fallo que sólo aparecería en producción.
    this.stripe = new Stripe(secretKey);
  }

  async ensureProduct({ serviceId, name, description }: EnsureProductInput): Promise<string> {
    const id = productIdFor(serviceId);
    try {
      const existing = await this.stripe.products.retrieve(id);
      // El nombre y la descripción SÍ se pueden actualizar (son texto comercial, no importe) y deben
      // seguir al catálogo. El importe no se toca aquí: vive en el `Price`.
      if (existing.name !== name || (existing.description ?? "") !== description) {
        await this.stripe.products.update(id, { name, description });
      }
      return existing.id;
    } catch (err) {
      if (!isResourceMissing(err)) throw err;
      const created = await this.stripe.products.create({ id, name, description });
      return created.id;
    }
  }

  async findActiveRecurringPrice({
    productId,
    amount,
    currency,
  }: RecurringPriceInput): Promise<string | null> {
    const page = await this.stripe.prices.list({
      product: productId,
      active: true,
      type: "recurring",
      currency,
      limit: 100,
    });
    const match = page.data.find(
      (p) =>
        p.unit_amount === amount &&
        p.currency === currency &&
        p.recurring?.interval === "month" &&
        p.recurring?.interval_count === 1
    );
    return match?.id ?? null;
  }

  async createRecurringPrice({
    productId,
    amount,
    currency,
  }: RecurringPriceInput): Promise<string> {
    const price = await this.stripe.prices.create({
      product: productId,
      currency,
      unit_amount: amount,
      // `licensed` y no `metered`: se cobra por agente activo (cantidad declarada), no por consumo
      // medido. El consumo de tokens ya lo gobierna el cupo de H4, que no es dinero.
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    });
    return price.id;
  }

  async archivePrice(priceId: string): Promise<void> {
    await this.stripe.prices.update(priceId, { active: false });
  }

  async countSubscriptionsOnPrice(priceId: string): Promise<number> {
    let total = 0;
    // `autoPagingEach` para no dar un número truncado: informar "3 clientes en la tarifa vieja"
    // cuando son 300 es peor que no informar.
    for await (const _sub of this.stripe.subscriptions.list({ price: priceId, status: "all" })) {
      total += 1;
    }
    return total;
  }

  async ensureCustomer({
    tenantId,
    name,
    email,
    existingCustomerId,
  }: EnsureCustomerInput): Promise<string> {
    if (existingCustomerId) {
      try {
        const existing = await this.stripe.customers.retrieve(existingCustomerId);
        // `deleted` es una forma real que devuelve `retrieve`: un customer borrado en el panel de
        // Stripe sigue respondiendo, y reutilizarlo daría un checkout que falla al cobrar.
        if (!existing.deleted) return existing.id;
      } catch (err) {
        if (!isResourceMissing(err)) throw err;
        // Guardado en AA pero inexistente en Stripe (entorno cambiado, borrado a mano): se crea otro.
      }
    }
    const created = await this.stripe.customers.create({
      name,
      email: email ?? undefined,
      // El vínculo que el webhook prefiere sobre los ids (handlers.ts, `resolveTenant`).
      metadata: { tenantId },
    });
    return created.id;
  }

  async createSubscriptionCheckout({
    customerId,
    priceId,
    quantity,
    tenantId,
    serviceId,
    successUrl,
    cancelUrl,
  }: CheckoutInput): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      // En los DOS sitios a propósito. `metadata` viaja en la sesión; `subscription_data.metadata`
      // acaba en la suscripción, que es el objeto que traen los `customer.subscription.*`. Ponerlo
      // sólo en la sesión dejaría al webhook resolviendo por ids, que es el camino más frágil.
      metadata: { tenantId, serviceId },
      subscription_data: { metadata: { tenantId, serviceId } },
    });
    // Una sesión sin URL no es utilizable; fallar aquí es mejor que devolver `null` al panel.
    if (!session.url) throw new Error("Stripe devolvió una sesión de checkout sin URL");
    return { id: session.id, url: session.url };
  }
}

function isResourceMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "resource_missing"
  );
}

/**
 * Construye el gateway real desde el entorno. Falla si falta la clave — no hay modo degradado: un
 * `stripe:sync` que "funciona" sin clave dejaría el mapa vacío y el checkout sin `priceId`.
 */
export function getStripeGateway(): StripeGateway {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY no configurada");
  return new RealStripeGateway(key);
}
