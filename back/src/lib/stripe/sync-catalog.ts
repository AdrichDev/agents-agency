/**
 * H6 (aa-stripe-suscripciones, T2.3) — Siembra de Stripe desde el catálogo.
 *
 * El catálogo es la FUENTE del importe y Stripe quien lo EJECUTA (design §D1). Este módulo es el
 * único sitio donde esa dirección se materializa: lee `SERVICE_CATALOG` —el espejo generado de
 * `front/lib/service-catalog.json`— y garantiza en Stripe un `Product` y un `Price` recurrente por
 * cada servicio de suscripción. Ningún importe se escribe aquí (AC1).
 *
 * La lógica vive separada del script de CLI a propósito: así se ejecuta de verdad en los tests contra
 * el doble en memoria, sin cuenta de Stripe y sin red (AC15).
 */
import { prisma } from "@/lib/db";
import { SERVICE_CATALOG, type ServiceEntry } from "@/lib/service-catalog";
import type { StripeGateway, StripeMode } from "@/lib/stripe/gateway";

export const STRIPE_CURRENCY = "eur";

/**
 * Servicios que el catálogo cobra al mes pero que NO son suscripción de plataforma.
 *
 * `tokens_5m` y `tokens_10m` son recargas de cupo. Se excluyen por una razón técnica concreta y no
 * por despiste: hoy no hay dónde acumularlas. El único campo con esa forma es `Tenant.tokenBalance`,
 * que es el OVERRIDE del cupo — escribir ahí conmutaría al tenant a `source: "override"` y
 * desactivaría su plan de forma permanente e invisible (`quota.ts:88`). Cobrar algo que la plataforma
 * no sabe aplicar es peor que no venderlo. Necesitan columna propia acumulable por periodo: otro
 * change.
 */
export const NON_SUBSCRIPTION_SERVICES = new Set(["tokens_5m", "tokens_10m"]);

/** Un servicio genera suscripción si el catálogo le pone mensualidad y no es una recarga. */
export function isSubscriptionService(entry: ServiceEntry): boolean {
  return entry.maintPrice > 0 && !NON_SUBSCRIPTION_SERVICES.has(entry.id);
}

/**
 * Euros del catálogo → céntimos de Stripe.
 *
 * `Math.round` y no `Math.trunc`: `18.7 * 100` es `1869.9999...` en coma flotante y truncar cobraría
 * un céntimo de menos para siempre. Ninguna cifra del catálogo tiene decimales hoy, pero el día que
 * los tenga este redondeo es la diferencia entre cobrar bien y cobrar mal.
 */
export function toCents(euros: number): number {
  return Math.round(euros * 100);
}

export interface SyncedService {
  serviceId: string;
  productId: string;
  priceId: string;
  amount: number;
  /** `true` si este `Price` se acaba de crear; `false` si ya existía y se reutilizó. */
  priceCreated: boolean;
  /** `priceId` anterior que quedó archivado, si la tarifa cambió. */
  archivedPriceId?: string;
  /** Suscripciones que se quedan en la tarifa vieja. Sólo se calcula cuando hay archivo. */
  subscriptionsOnOldPrice?: number;
}

export interface SyncReport {
  mode: StripeMode;
  synced: SyncedService[];
  skipped: { serviceId: string; reason: string }[];
}

export interface SyncOptions {
  gateway: StripeGateway;
  /** Por defecto el catálogo completo. Parametrizado para que los tests puedan variar un importe. */
  catalog?: ServiceEntry[];
}

/**
 * Garantiza en Stripe el `Product` y el `Price` vigente de cada servicio de suscripción, y deja el
 * mapa `(serviceId, mode) → (productId, priceId, amount)` al día.
 *
 * Idempotente (AC2): si el importe del catálogo no cambió, reutiliza el `Price` activo que ya existe y
 * no crea ni modifica nada en Stripe.
 *
 * Al subir un importe (AC3): crea un `Price` nuevo, lo marca vigente, archiva el anterior y devuelve
 * cuántas suscripciones se quedan en la tarifa vieja. **No migra ninguna suscripción** — eso es una
 * decisión comercial, no una consecuencia de editar un JSON.
 */
export async function syncStripeCatalog({ gateway, catalog }: SyncOptions): Promise<SyncReport> {
  const entries = catalog ?? SERVICE_CATALOG;
  const report: SyncReport = { mode: gateway.mode, synced: [], skipped: [] };

  for (const entry of entries) {
    if (!isSubscriptionService(entry)) {
      report.skipped.push({
        serviceId: entry.id,
        reason: NON_SUBSCRIPTION_SERVICES.has(entry.id)
          ? "recarga de cupo, fuera de alcance de H6"
          : "sin mensualidad (maintPrice = 0)",
      });
      continue;
    }

    // El importe recurrente es SÓLO `maintPrice`. `implPrice` no entra aquí ni en ningún otro sitio de
    // este módulo: la implantación se factura con el módulo de facturas de AA (design §D9, AC17).
    const amount = toCents(entry.maintPrice);

    const productId = await gateway.ensureProduct({
      serviceId: entry.id,
      name: entry.name,
      description: entry.description,
    });

    const existing = await gateway.findActiveRecurringPrice({
      productId,
      amount,
      currency: STRIPE_CURRENCY,
    });
    const priceId =
      existing ??
      (await gateway.createRecurringPrice({ productId, amount, currency: STRIPE_CURRENCY }));

    const result: SyncedService = {
      serviceId: entry.id,
      productId,
      priceId,
      amount,
      priceCreated: existing === null,
    };

    const previous = await prisma.stripePriceMap.findUnique({
      where: { serviceId_mode: { serviceId: entry.id, mode: gateway.mode } },
    });

    // Se cuenta ANTES de archivar. Después del archivo la lista sigue siendo consultable, pero
    // preguntar primero deja el número en el informe aunque el archivo falle a mitad.
    if (previous && previous.priceId !== priceId) {
      result.subscriptionsOnOldPrice = await gateway.countSubscriptionsOnPrice(previous.priceId);
      await gateway.archivePrice(previous.priceId);
      result.archivedPriceId = previous.priceId;
    }

    await prisma.stripePriceMap.upsert({
      where: { serviceId_mode: { serviceId: entry.id, mode: gateway.mode } },
      create: {
        serviceId: entry.id,
        mode: gateway.mode,
        productId,
        priceId,
        amount,
        currency: STRIPE_CURRENCY,
      },
      update: { productId, priceId, amount, currency: STRIPE_CURRENCY },
    });

    report.synced.push(result);
  }

  return report;
}

/**
 * Tripwire de deriva catálogo ↔ Stripe (T2.5). Compara el importe de cada `Price` vigente del mapa
 * con el del catálogo y devuelve las diferencias.
 *
 * No es un test: necesita el mapa real y, en su uso de despliegue, la cuenta real. Es un comando.
 */
export async function checkStripeDrift(mode: StripeMode): Promise<
  { serviceId: string; catalogAmount: number; mappedAmount: number | null }[]
> {
  const rows = await prisma.stripePriceMap.findMany({ where: { mode } });
  const byService = new Map(rows.map((r) => [r.serviceId, r]));
  const drift: { serviceId: string; catalogAmount: number; mappedAmount: number | null }[] = [];

  for (const entry of SERVICE_CATALOG) {
    if (!isSubscriptionService(entry)) continue;
    const expected = toCents(entry.maintPrice);
    const mapped = byService.get(entry.id);
    if (!mapped || mapped.amount !== expected) {
      drift.push({
        serviceId: entry.id,
        catalogAmount: expected,
        mappedAmount: mapped?.amount ?? null,
      });
    }
  }

  return drift;
}
