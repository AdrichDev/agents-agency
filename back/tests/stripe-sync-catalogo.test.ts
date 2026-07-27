/**
 * H6 (aa-stripe-suscripciones, T2.4) — E1, E2, E13.
 *
 * Ejecuta la siembra DE VERDAD contra el doble en memoria: sin cuenta de Stripe y sin un byte de red
 * (AC15). Lo que se afirma:
 *
 *   E1 (AC1, AC2) — el `Price` se crea con el importe del catálogo, y una segunda pasada no toca nada.
 *   E2 (AC3)      — subir la tarifa crea un `Price` nuevo, archiva el viejo y NO mueve a quien firmó.
 *   E13 (AC17)    — `implPrice` no llega nunca a Stripe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    stripePriceMap: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { SERVICE_CATALOG, type ServiceEntry } from "@/lib/service-catalog";
import { productIdFor } from "@/lib/stripe/gateway";
import { isSubscriptionService, syncStripeCatalog, toCents } from "@/lib/stripe/sync-catalog";
import { FakeStripeGateway } from "./helpers/fake-stripe";

const findUnique = prisma.stripePriceMap.findUnique as ReturnType<typeof vi.fn>;
const upsert = prisma.stripePriceMap.upsert as ReturnType<typeof vi.fn>;

/**
 * Base de datos en memoria para `StripePriceMap`, con la misma clave compuesta que el schema. Se
 * mockea `@/lib/db` (convención del repo) pero el mock GUARDA estado: sin él, la segunda pasada de
 * `stripe:sync` no encontraría la fila anterior y el test de idempotencia comprobaría otra cosa.
 */
function wirePriceMapStore() {
  const rows = new Map<string, { serviceId: string; mode: string; productId: string; priceId: string; amount: number }>();
  const key = (serviceId: string, mode: string) => `${serviceId}::${mode}`;

  findUnique.mockImplementation(async ({ where }: any) => {
    const { serviceId, mode } = where.serviceId_mode;
    return rows.get(key(serviceId, mode)) ?? null;
  });
  upsert.mockImplementation(async ({ where, create, update }: any) => {
    const { serviceId, mode } = where.serviceId_mode;
    const existing = rows.get(key(serviceId, mode));
    const row = existing ? { ...existing, ...update } : { ...create };
    rows.set(key(serviceId, mode), row);
    return row;
  });

  return rows;
}

const CHATBOT_PLUS: ServiceEntry = {
  id: "chatbot_plus",
  name: "Agente IA — Plus",
  description: "Plus",
  implPrice: 1290,
  maintPrice: 99,
  tokens: 10_000_000,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("E1 (AC1, AC2) — la siembra usa el importe del catálogo y es idempotente", () => {
  it("crea un Price recurrente mensual de 9900 céntimos para chatbot_plus", async () => {
    wirePriceMapStore();
    const stripe = new FakeStripeGateway("test");

    const report = await syncStripeCatalog({ gateway: stripe, catalog: [CHATBOT_PLUS] });

    expect(report.synced).toHaveLength(1);
    const [synced] = report.synced;
    expect(synced.amount).toBe(9900);
    expect(synced.priceCreated).toBe(true);

    const price = stripe.prices.find((p) => p.id === synced.priceId)!;
    expect(price.amount).toBe(9900);
    expect(price.currency).toBe("eur");
    expect(price.interval).toBe("month");
    expect(price.active).toBe(true);
    expect(price.productId).toBe(productIdFor("chatbot_plus"));
  });

  it("una segunda pasada sin cambios no crea ni modifica NADA en Stripe", async () => {
    wirePriceMapStore();
    const stripe = new FakeStripeGateway("test");

    const first = await syncStripeCatalog({ gateway: stripe, catalog: [CHATBOT_PLUS] });
    stripe.resetCalls();
    const second = await syncStripeCatalog({ gateway: stripe, catalog: [CHATBOT_PLUS] });

    // Por AUSENCIA de llamadas, no sólo por estado final: dos pasadas que crearan y archivaran
    // dejarían el mismo estado que una que no toca nada.
    expect(stripe.calls.createPrice).toBe(0);
    expect(stripe.calls.archivePrice).toBe(0);
    expect(stripe.calls.createProduct).toBe(0);
    expect(stripe.calls.updateProduct).toBe(0);

    expect(second.synced[0].priceId).toBe(first.synced[0].priceId);
    expect(second.synced[0].priceCreated).toBe(false);
    expect(stripe.prices).toHaveLength(1);
  });

  it("ningún importe del catálogo aparece hardcodeado: el Price sigue al catálogo", async () => {
    wirePriceMapStore();
    const stripe = new FakeStripeGateway("test");

    // Mismo servicio con OTRO importe. Si la implementación llevara 9900 escrito, esto seguiría
    // dando 9900 y el test caería.
    await syncStripeCatalog({
      gateway: stripe,
      catalog: [{ ...CHATBOT_PLUS, maintPrice: 123 }],
    });

    expect(stripe.prices[0].amount).toBe(12300);
  });
});

describe("E2 (AC3) — subir la tarifa no toca a quien ya firmó", () => {
  it("crea Price nuevo, archiva el viejo y la suscripción sigue en el importe antiguo", async () => {
    wirePriceMapStore();
    const stripe = new FakeStripeGateway("test");

    const first = await syncStripeCatalog({ gateway: stripe, catalog: [CHATBOT_PLUS] });
    const oldPriceId = first.synced[0].priceId;
    const firmada = stripe.addSubscription(oldPriceId, 3);

    const second = await syncStripeCatalog({
      gateway: stripe,
      catalog: [{ ...CHATBOT_PLUS, maintPrice: 109 }],
    });

    const nuevo = second.synced[0];
    expect(nuevo.amount).toBe(10900);
    expect(nuevo.priceId).not.toBe(oldPriceId);
    expect(nuevo.priceCreated).toBe(true);
    expect(nuevo.archivedPriceId).toBe(oldPriceId);

    // El viejo queda inactivo pero NO cambia de importe: los `Price` de Stripe son inmutables.
    const viejo = stripe.prices.find((p) => p.id === oldPriceId)!;
    expect(viejo.active).toBe(false);
    expect(viejo.amount).toBe(9900);

    // Y el cliente que firmó sigue apuntando al viejo. Migrarlo es decisión comercial.
    expect(firmada.priceId).toBe(oldPriceId);
    expect(stripe.amountChargedTo(firmada.id)).toBe(9900);
  });

  it("informa de cuántas suscripciones se quedan en la tarifa vieja", async () => {
    wirePriceMapStore();
    const stripe = new FakeStripeGateway("test");

    const first = await syncStripeCatalog({ gateway: stripe, catalog: [CHATBOT_PLUS] });
    stripe.addSubscription(first.synced[0].priceId);
    stripe.addSubscription(first.synced[0].priceId);

    const second = await syncStripeCatalog({
      gateway: stripe,
      catalog: [{ ...CHATBOT_PLUS, maintPrice: 109 }],
    });

    // Un archivo silencioso dejaría a dos clientes en una tarifa que ya no se anuncia sin que nadie
    // lo supiera.
    expect(second.synced[0].subscriptionsOnOldPrice).toBe(2);
  });

  it("cuenta las suscripciones ANTES de archivar el Price", async () => {
    wirePriceMapStore();
    const stripe = new FakeStripeGateway("test");
    const first = await syncStripeCatalog({ gateway: stripe, catalog: [CHATBOT_PLUS] });
    stripe.addSubscription(first.synced[0].priceId);

    const orden: string[] = [];
    const countSpy = vi
      .spyOn(stripe, "countSubscriptionsOnPrice")
      .mockImplementation(async (id) => {
        orden.push("count");
        return stripe.subscriptions.filter((s) => s.priceId === id).length;
      });
    const archiveSpy = vi.spyOn(stripe, "archivePrice").mockImplementation(async () => {
      orden.push("archive");
    });

    await syncStripeCatalog({ gateway: stripe, catalog: [{ ...CHATBOT_PLUS, maintPrice: 109 }] });

    expect(orden).toEqual(["count", "archive"]);
    countSpy.mockRestore();
    archiveSpy.mockRestore();
  });
});

describe("E13 (AC17) — la implantación no pasa por Stripe", () => {
  it("ningún Price se crea con implPrice", async () => {
    wirePriceMapStore();
    const stripe = new FakeStripeGateway("test");

    await syncStripeCatalog({ gateway: stripe, catalog: [CHATBOT_PLUS] });

    const importes = stripe.prices.map((p) => p.amount);
    expect(importes).not.toContain(toCents(CHATBOT_PLUS.implPrice)); // 129000
    expect(importes).toEqual([9900]);
  });

  it("ningún servicio del catálogo real siembra su implPrice", async () => {
    wirePriceMapStore();
    const stripe = new FakeStripeGateway("test");

    await syncStripeCatalog({ gateway: stripe });

    const implCents = new Set(
      SERVICE_CATALOG.filter((e) => e.implPrice > 0).map((e) => toCents(e.implPrice))
    );
    for (const price of stripe.prices) {
      // Ojo: `hours` tiene implPrice 75 y maintPrice 0, así que 7500 no debería aparecer tampoco.
      expect(implCents.has(price.amount)).toBe(false);
    }
  });
});

describe("Alcance de la siembra — qué entra y qué no", () => {
  it("`hours` no genera suscripción porque no tiene mensualidad", async () => {
    wirePriceMapStore();
    const stripe = new FakeStripeGateway("test");

    const report = await syncStripeCatalog({ gateway: stripe });

    expect(report.synced.map((s) => s.serviceId)).not.toContain("hours");
    expect(report.skipped.find((s) => s.serviceId === "hours")?.reason).toContain("maintPrice");
  });

  it("las recargas de tokens quedan fuera con motivo explícito", async () => {
    wirePriceMapStore();
    const stripe = new FakeStripeGateway("test");

    const report = await syncStripeCatalog({ gateway: stripe });

    for (const id of ["tokens_5m", "tokens_10m"]) {
      expect(report.synced.map((s) => s.serviceId)).not.toContain(id);
      expect(report.skipped.find((s) => s.serviceId === id)?.reason).toContain("fuera de alcance");
    }
  });

  it("siembra exactamente los siete servicios de suscripción del catálogo", async () => {
    wirePriceMapStore();
    const stripe = new FakeStripeGateway("test");

    const report = await syncStripeCatalog({ gateway: stripe });

    // La lista no está escrita a mano aquí: se deriva del catálogo. Si mañana se añade un servicio
    // con mensualidad, este test lo incluye solo en vez de quedarse obsoleto en silencio.
    const esperados = SERVICE_CATALOG.filter(isSubscriptionService).map((e) => e.id);
    expect(report.synced.map((s) => s.serviceId)).toEqual(esperados);
    expect(esperados).toHaveLength(7);
  });

  it("el importe sembrado de cada servicio es su maintPrice en céntimos", async () => {
    wirePriceMapStore();
    const stripe = new FakeStripeGateway("test");

    const report = await syncStripeCatalog({ gateway: stripe });

    for (const synced of report.synced) {
      const entry = SERVICE_CATALOG.find((e) => e.id === synced.serviceId)!;
      expect(synced.amount).toBe(toCents(entry.maintPrice));
    }
  });
});

describe("El mapa distingue test de live (AC de §D2)", () => {
  it("sembrar en live no pisa la fila de test", async () => {
    const rows = wirePriceMapStore();

    await syncStripeCatalog({ gateway: new FakeStripeGateway("test"), catalog: [CHATBOT_PLUS] });
    await syncStripeCatalog({ gateway: new FakeStripeGateway("live"), catalog: [CHATBOT_PLUS] });

    expect(rows.get("chatbot_plus::test")).toBeTruthy();
    expect(rows.get("chatbot_plus::live")).toBeTruthy();
    expect(rows.size).toBe(2);
  });
});
