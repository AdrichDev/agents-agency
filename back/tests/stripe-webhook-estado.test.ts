/**
 * H6 (aa-stripe-suscripciones, T4.6) — E3, E11 y AC5.
 *
 * E3 (AC4): un webhook de impago escribe `subscriptionStatus` y NO toca `isActive`.
 * E11 (AC14): el ancla del periodo sale de Stripe, no del reloj del servidor.
 * AC5: ningún manejador escribe `isActive` — test de lectura sobre el código.
 *
 * Sobre AC5: es un test que lee el fuente, no que ejecuta. Suena a trampa y no lo es. La propiedad que
 * hay que garantizar es UNIVERSAL ("ninguna ruta de ningún manejador, presente o futuro, escribe esa
 * columna") y los tests de comportamiento sólo cubren las ramas que a uno se le ocurre invocar. Aquí lo
 * que protege es justamente al manejador que alguien añada mañana. Se ejecuta ahora y no en T1 porque
 * ahora hay manejadores que leer: en T1 el mismo test habría pasado en vacío, que es peor que no tenerlo.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findUnique: vi.fn(), update: vi.fn() },
    stripeEvent: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { prisma } from "@/lib/db";
import {
  handleStripeEvent,
  HANDLED_EVENT_TYPES,
  readAnchorSeconds,
  readPeriodStartSeconds,
} from "@/lib/stripe/handlers";

const TENANT_ID = "tenant_estado";

/** 15 de marzo de 2026, 10:30 UTC. Día del mes = 15. */
const ANCLA = Math.floor(Date.UTC(2026, 2, 15, 10, 30, 0) / 1000);
/** 15 de julio de 2026, 10:30 UTC — el periodo en curso, cuatro ciclos después. */
const PERIODO = Math.floor(Date.UTC(2026, 6, 15, 10, 30, 0) / 1000);

type Mock = ReturnType<typeof vi.fn>;

function tenantMocks() {
  return prisma.tenant as unknown as { findUnique: Mock; update: Mock };
}

/** Datos escritos en la última llamada a `tenant.update`. */
function ultimaEscritura(): Record<string, unknown> {
  const calls = tenantMocks().update.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0].data as Record<string, unknown>;
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_estado",
    customer: "cus_estado",
    status: "active",
    billing_cycle_anchor: ANCLA,
    start_date: ANCLA,
    items: { data: [{ current_period_start: PERIODO }] },
    metadata: { tenantId: TENANT_ID },
    ...overrides,
  };
}

function evento(type: string, object: Record<string, unknown>) {
  return { id: `evt_${type}`, type, data: { object } };
}

beforeEach(() => {
  const t = tenantMocks();
  t.findUnique.mockReset();
  t.update.mockReset();
  t.findUnique.mockResolvedValue({ id: TENANT_ID });
  t.update.mockResolvedValue({ id: TENANT_ID });
});

// ---------------------------------------------------------------------------
// E3 (AC4) — impago escribe estado, no `isActive`
// ---------------------------------------------------------------------------

describe("E3 (AC4) — `invoice.payment_failed` marca past_due sin tocar isActive", () => {
  it("escribe subscriptionStatus = past_due", async () => {
    const result = await handleStripeEvent(
      evento("invoice.payment_failed", {
        id: "in_1",
        customer: "cus_estado",
        parent: { subscription_details: { subscription: "sub_estado" } },
        metadata: { tenantId: TENANT_ID },
      })
    );

    expect(result).toEqual({ handled: true, tenantId: TENANT_ID, detail: "estado=past_due" });
    expect(ultimaEscritura()).toEqual({ subscriptionStatus: "past_due" });
  });

  it("`invoice.paid` marca active y tampoco escribe nada más", async () => {
    await handleStripeEvent(
      evento("invoice.paid", {
        id: "in_2",
        customer: "cus_estado",
        subscription: "sub_estado",
        metadata: { tenantId: TENANT_ID },
      })
    );
    // Sólo esa clave. Un `isActive: true` aquí desharía una suspensión manual sin rastro (design §D3).
    expect(ultimaEscritura()).toEqual({ subscriptionStatus: "active" });
  });

  it("un `invoice.paid` NO reactiva a un cliente suspendido a mano", async () => {
    // El tenant está apagado por decisión del propietario. Que pague la factura no lo enciende: son dos
    // hechos distintos, y sólo el propietario puede deshacer el suyo.
    tenantMocks().findUnique.mockResolvedValue({ id: TENANT_ID });
    await handleStripeEvent(
      evento("invoice.paid", { id: "in_3", customer: "cus_estado", metadata: { tenantId: TENANT_ID } })
    );
    expect(ultimaEscritura()).not.toHaveProperty("isActive");
  });

  it("ningún tipo manejado escribe isActive, en ninguna de sus ramas", async () => {
    for (const type of HANDLED_EVENT_TYPES) {
      tenantMocks().update.mockClear();
      const object = type.startsWith("customer.subscription")
        ? subscription()
        : {
            id: "in_x",
            customer: "cus_estado",
            subscription: "sub_estado",
            metadata: { tenantId: TENANT_ID },
          };
      await handleStripeEvent(evento(type, object));
      expect(ultimaEscritura(), `tipo ${type}`).not.toHaveProperty("isActive");
      expect(ultimaEscritura(), `tipo ${type}`).not.toHaveProperty("activo");
    }
  });
});

// ---------------------------------------------------------------------------
// E11 (AC14) — el ancla viene de Stripe
// ---------------------------------------------------------------------------

describe("E11 (AC14) — ancla y periodo salen del payload de Stripe", () => {
  it("periodAnchorDay es el día UTC de billing_cycle_anchor", async () => {
    await handleStripeEvent(evento("customer.subscription.created", subscription()));
    const data = ultimaEscritura();
    expect(data.periodAnchorDay).toBe(15);
  });

  it("periodStart es el current_period_start de los items, no billing_cycle_anchor", async () => {
    // Es la distinción que el design tenía mal: en la API `2026-06-24.dahlia` el objeto `Subscription`
    // ya no lleva `current_period_start`; vive en cada `SubscriptionItem`.
    await handleStripeEvent(evento("customer.subscription.updated", subscription()));
    const data = ultimaEscritura();
    expect(data.periodStart).toEqual(new Date(PERIODO * 1000));
    expect(data.periodStart).not.toEqual(new Date(ANCLA * 1000));
    expect(data.tokensUsedPeriod).toBe(0);
  });

  it("no usa el reloj del servidor: el ancla del pasado se respeta tal cual", async () => {
    await handleStripeEvent(evento("customer.subscription.created", subscription()));
    const data = ultimaEscritura();
    const hoy = new Date().getUTCDate();
    // El test sería tramposo si hoy fuera día 15; se comprueba explícitamente que no coinciden.
    if (hoy !== 15) expect(data.periodAnchorDay).not.toBe(hoy);
    expect((data.periodStart as Date).getTime()).toBeLessThan(Date.now() + 1);
  });

  it("con varios items toma el mínimo current_period_start", async () => {
    const anterior = PERIODO - 86_400;
    await handleStripeEvent(
      evento(
        "customer.subscription.updated",
        subscription({
          items: { data: [{ current_period_start: PERIODO }, { current_period_start: anterior }] },
        })
      )
    );
    expect(ultimaEscritura().periodStart).toEqual(new Date(anterior * 1000));
  });

  it("`.deleted` no mueve el ciclo de cupo", async () => {
    // Una suscripción cancelada no debe reiniciar ni desplazar el periodo: el cliente sigue existiendo.
    const result = await handleStripeEvent(
      evento("customer.subscription.deleted", subscription({ status: "canceled" }))
    );
    const data = ultimaEscritura();
    expect(result).toEqual({ handled: true, tenantId: TENANT_ID, detail: "estado=canceled" });
    expect(data.subscriptionStatus).toBe("canceled");
    expect(data).not.toHaveProperty("periodAnchorDay");
    expect(data).not.toHaveProperty("periodStart");
    expect(data).not.toHaveProperty("tokensUsedPeriod");
  });

  it("sin ancla y sin items no escribe basura, sólo el estado", async () => {
    await handleStripeEvent(
      evento(
        "customer.subscription.updated",
        subscription({ billing_cycle_anchor: undefined, start_date: undefined, items: undefined })
      )
    );
    const data = ultimaEscritura();
    expect(data.subscriptionStatus).toBe("active");
    expect(data).not.toHaveProperty("periodAnchorDay");
    expect(data).not.toHaveProperty("periodStart");
  });

  describe("lectores del payload", () => {
    it("readAnchorSeconds cae a start_date si falta billing_cycle_anchor", () => {
      expect(readAnchorSeconds({ billing_cycle_anchor: ANCLA, start_date: 1 })).toBe(ANCLA);
      expect(readAnchorSeconds({ start_date: ANCLA })).toBe(ANCLA);
      expect(readAnchorSeconds({})).toBeNull();
    });

    it("readPeriodStartSeconds devuelve null con items vacíos o sin el campo", () => {
      expect(readPeriodStartSeconds({ items: { data: [] } })).toBeNull();
      expect(readPeriodStartSeconds({ items: { data: [{}] } })).toBeNull();
      expect(readPeriodStartSeconds({})).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Resolución de tenant y tipos no manejados
// ---------------------------------------------------------------------------

describe("resolución de tenant — nunca lo crea", () => {
  it("cliente desconocido: handled false, sin escrituras", async () => {
    tenantMocks().findUnique.mockResolvedValue(null);
    const result = await handleStripeEvent(evento("customer.subscription.updated", subscription()));
    expect(result).toEqual({
      handled: false,
      reason: "cliente de Stripe desconocido: cus_estado",
    });
    expect(tenantMocks().update).not.toHaveBeenCalled();
  });

  it("sin metadata cae al id de suscripción y luego al de cliente", async () => {
    const t = tenantMocks();
    t.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: TENANT_ID });
    await handleStripeEvent(
      evento("customer.subscription.updated", subscription({ metadata: {} }))
    );
    const wheres = t.findUnique.mock.calls.map((c) => c[0].where);
    expect(wheres[0]).toEqual({ stripeSubscriptionId: "sub_estado" });
    expect(wheres[1]).toEqual({ stripeCustomerId: "cus_estado" });
  });

  it("acepta `customer` expandido como objeto", async () => {
    await handleStripeEvent(
      evento("customer.subscription.updated", subscription({ customer: { id: "cus_expandido" } }))
    );
    expect(ultimaEscritura().stripeCustomerId).toBe("cus_expandido");
  });

  it("suscripción sin id o sin estado se ignora", async () => {
    const sinId = await handleStripeEvent(
      evento("customer.subscription.updated", subscription({ id: undefined }))
    );
    expect(sinId).toEqual({ handled: false, reason: "suscripción sin id o sin estado" });
    expect(tenantMocks().update).not.toHaveBeenCalled();
  });
});

describe("tipos no manejados", () => {
  it("`checkout.session.completed` cae en el default y no se procesa", async () => {
    // La implantación se factura con el módulo de facturas de AA, no con Stripe (design §D9, AC17).
    const result = await handleStripeEvent(
      evento("checkout.session.completed", { id: "cs_1", mode: "payment" })
    );
    expect(result).toEqual({
      handled: false,
      reason: "tipo no manejado: checkout.session.completed",
    });
    expect(tenantMocks().update).not.toHaveBeenCalled();
  });

  it("los cinco tipos manejados son exactamente los del design", () => {
    expect([...HANDLED_EVENT_TYPES].sort()).toEqual([
      "customer.subscription.created",
      "customer.subscription.deleted",
      "customer.subscription.updated",
      "invoice.paid",
      "invoice.payment_failed",
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC5 — test de lectura sobre el código de los manejadores
// ---------------------------------------------------------------------------

describe("AC5 — ningún manejador de Stripe escribe isActive (lectura del fuente)", () => {
  const FUENTES = [
    "../src/lib/stripe/handlers.ts",
    "../src/lib/stripe/event-log.ts",
    "../src/routes/service-stripe.ts",
  ];

  /** Lee el fuente sin comentarios: la palabra `isActive` aparece a propósito en la documentación. */
  function codigoSinComentarios(relativo: string): string {
    const texto = readFileSync(new URL(relativo, import.meta.url), "utf8");
    return texto
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("los tres ficheros existen y tienen contenido (el test no puede pasar en vacío)", () => {
    for (const f of FUENTES) {
      expect(codigoSinComentarios(f).length, f).toBeGreaterThan(200);
    }
  });

  it("ninguno menciona isActive ni la columna `activo` fuera de comentarios", () => {
    for (const f of FUENTES) {
      const codigo = codigoSinComentarios(f);
      expect(codigo, f).not.toMatch(/\bisActive\b/);
      expect(codigo, f).not.toMatch(/["']activo["']/);
    }
  });

  it("handlers.ts sí escribe subscriptionStatus (la columna correcta)", () => {
    // El complemento del test anterior: si no escribiera nada, "no escribe isActive" sería trivial.
    expect(codigoSinComentarios("../src/lib/stripe/handlers.ts")).toMatch(/subscriptionStatus/);
  });

  it("handlers.ts no escribe tokenBalance", () => {
    // `tokenBalance` es el override manual del cupo (quota.ts:88). Un webhook que sumara ahí dejaría al
    // tenant en `source: "override"` para siempre, desactivando su plan sin que se vea.
    expect(codigoSinComentarios("../src/lib/stripe/handlers.ts")).not.toMatch(/\btokenBalance\b/);
  });
});
