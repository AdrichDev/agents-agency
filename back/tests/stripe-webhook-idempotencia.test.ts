/**
 * H6 (aa-stripe-suscripciones, T3.5) — E7 y E8: el mismo evento dos veces no cobra dos veces, y un
 * evento que falló a medias SÍ se reintenta.
 *
 * Las dos mitades importan lo mismo y tiran en direcciones opuestas. Descartar duplicados es fácil;
 * lo difícil es descartarlos SIN convertir el primer fallo transitorio en un cobro perdido en silencio.
 * Por eso `processedAt` tiene tres estados y no dos (event-log.ts).
 *
 * El almacén de `stripeEvent` es un Map con estado real, no un `vi.fn()` que devuelve siempre lo mismo:
 * con un mock sin estado la segunda entrega no encontraría la fila de la primera y el test de
 * idempotencia no probaría nada. El `create` simula el unique de PostgreSQL lanzando `P2002`, que es
 * exactamente la primitiva sobre la que se apoya `registerStripeEvent`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    stripeEvent: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { prisma } from "@/lib/db";
import {
  markStripeEventFailed,
  markStripeEventProcessed,
  registerStripeEvent,
} from "@/lib/stripe/event-log";
import { stripeWebhookHandler } from "@/routes/service-stripe";
import { buildSignatureHeader } from "@/lib/stripe/webhook-signature";

const WEBHOOK_SECRET = "whsec_test_idempotencia";
const TENANT_ID = "tenant_idem";

interface EventRow {
  id: string;
  type: string;
  processedAt: Date | null;
  error: string | null;
}

/** Estado del almacén de eventos, compartido por los tres métodos mockeados. */
let store: Map<string, EventRow>;

/** Error con la forma que Prisma da a una violación de unique. */
function p2002(): Error & { code: string } {
  const err = new Error("Unique constraint failed on the fields: (`id`)") as Error & { code: string };
  err.code = "P2002";
  return err;
}

function wireEventStore() {
  store = new Map();
  const db = prisma as unknown as {
    stripeEvent: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  db.stripeEvent.create.mockReset();
  db.stripeEvent.findUnique.mockReset();
  db.stripeEvent.update.mockReset();

  db.stripeEvent.create.mockImplementation(async ({ data }: { data: EventRow }) => {
    if (store.has(data.id)) throw p2002();
    const row: EventRow = { id: data.id, type: data.type, processedAt: null, error: null };
    store.set(row.id, row);
    return row;
  });

  db.stripeEvent.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    return store.get(where.id) ?? null;
  });

  db.stripeEvent.update.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: Partial<EventRow> }) => {
      const row = store.get(where.id);
      if (!row) throw new Error("fila inexistente");
      Object.assign(row, data);
      return row;
    }
  );
}

// ---------------------------------------------------------------------------
// Dobles mínimos de express
// ---------------------------------------------------------------------------

interface FakeRes {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function fakeReq(event: unknown, secret = WEBHOOK_SECRET) {
  const rawBody = Buffer.from(JSON.stringify(event));
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    rawBody,
    headers: { "stripe-signature": buildSignatureHeader(timestamp, rawBody, secret) },
    body: event,
  } as never;
}

function subscriptionEvent(id: string, status = "active") {
  return {
    id,
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_idem",
        customer: "cus_idem",
        status,
        billing_cycle_anchor: 1_800_000_000,
        items: { data: [{ current_period_start: 1_800_000_000 }] },
        metadata: { tenantId: TENANT_ID },
      },
    },
  };
}

async function post(event: unknown) {
  const res = fakeRes();
  await stripeWebhookHandler(fakeReq(event), res as never);
  return res;
}

beforeEach(() => {
  wireEventStore();
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

  const tenant = prisma.tenant as unknown as {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  tenant.findUnique.mockReset();
  tenant.update.mockReset();
  tenant.findUnique.mockResolvedValue({ id: TENANT_ID });
  tenant.update.mockResolvedValue({ id: TENANT_ID });
});

// ---------------------------------------------------------------------------
// E7 — duplicado sin efecto
// ---------------------------------------------------------------------------

describe("E7 (AC9) — el mismo event.id dos veces se aplica una vez", () => {
  it("la segunda entrega no vuelve a escribir el tenant y responde duplicate", async () => {
    const evento = subscriptionEvent("evt_dup_1");

    const primera = await post(evento);
    expect(primera.statusCode).toBe(200);
    expect(primera.body).toEqual({ received: true, handled: true });
    expect(prisma.tenant.update).toHaveBeenCalledTimes(1);

    const segunda = await post(evento);
    expect(segunda.statusCode).toBe(200);
    expect(segunda.body).toEqual({ received: true, duplicate: true });
    // La prueba real de idempotencia es la AUSENCIA de una segunda escritura.
    expect(prisma.tenant.update).toHaveBeenCalledTimes(1);
  });

  it("un tercer y cuarto reintento siguen sin efecto", async () => {
    const evento = subscriptionEvent("evt_dup_2");
    await post(evento);
    await post(evento);
    await post(evento);
    await post(evento);
    expect(prisma.tenant.update).toHaveBeenCalledTimes(1);
  });

  it("eventos DISTINTOS sobre el mismo cliente sí se aplican los dos", async () => {
    // El de-duplicado es por `event.id`, no por cliente: dos cambios reales de estado son dos cambios.
    await post(subscriptionEvent("evt_a", "active"));
    await post(subscriptionEvent("evt_b", "past_due"));
    expect(prisma.tenant.update).toHaveBeenCalledTimes(2);
    const ultima = (prisma.tenant.update as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(ultima.data.subscriptionStatus).toBe("past_due");
  });

  it("registra la fila ANTES de procesar, no después", async () => {
    // Si el registro fuese posterior, un fallo del manejador dejaría el evento sin fila y la
    // exclusión por PK no serviría de nada.
    const orden: string[] = [];
    (prisma.stripeEvent.create as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async ({ data }: { data: EventRow }) => {
        orden.push("create");
        store.set(data.id, { id: data.id, type: data.type, processedAt: null, error: null });
        return store.get(data.id);
      }
    );
    (prisma.tenant.update as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      orden.push("procesa");
      return { id: TENANT_ID };
    });

    await post(subscriptionEvent("evt_orden"));
    expect(orden).toEqual(["create", "procesa"]);
  });
});

// ---------------------------------------------------------------------------
// E8 — el fallo a medias se reintenta
// ---------------------------------------------------------------------------

describe("E8 (AC10) — un evento visto pero sin terminar se reintenta", () => {
  it("tras un fallo, la reentrega vuelve a procesar y esta vez cierra", async () => {
    const evento = subscriptionEvent("evt_fallo");
    const tenantUpdate = prisma.tenant.update as unknown as ReturnType<typeof vi.fn>;
    tenantUpdate.mockRejectedValueOnce(new Error("conexión perdida a mitad"));

    const primera = await post(evento);
    // 500 a propósito: es lo que hace que Stripe reintente.
    expect(primera.statusCode).toBe(500);
    expect(store.get("evt_fallo")?.processedAt).toBeNull();
    expect(store.get("evt_fallo")?.error).toContain("conexión perdida");

    const segunda = await post(evento);
    expect(segunda.statusCode).toBe(200);
    expect(segunda.body).toEqual({ received: true, handled: true });
    expect(tenantUpdate).toHaveBeenCalledTimes(2);
    expect(store.get("evt_fallo")?.processedAt).toBeInstanceOf(Date);
    // Al cerrar bien se limpia el error del intento anterior: si no, un evento sano quedaría marcado
    // como problemático para siempre.
    expect(store.get("evt_fallo")?.error).toBeNull();
  });

  it("una vez cerrado, la tercera entrega ya se descarta", async () => {
    const evento = subscriptionEvent("evt_fallo_luego_ok");
    (prisma.tenant.update as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("timeout")
    );
    await post(evento); // 500
    await post(evento); // 200, procesa
    const tercera = await post(evento);
    expect(tercera.body).toEqual({ received: true, duplicate: true });
    expect(prisma.tenant.update).toHaveBeenCalledTimes(2);
  });

  it("un evento ignorado a conciencia queda cerrado y no se reintenta", async () => {
    // Tipo no manejado: 200 y `processedAt` puesto. Dejarlo abierto haría que Stripe lo reintentara
    // durante días algo que nunca vamos a procesar.
    const res = await post({ id: "evt_ignorado", type: "customer.created", data: { object: {} } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, handled: false });
    expect(store.get("evt_ignorado")?.processedAt).toBeInstanceOf(Date);

    const segunda = await post({ id: "evt_ignorado", type: "customer.created", data: { object: {} } });
    expect(segunda.body).toEqual({ received: true, duplicate: true });
  });
});

// ---------------------------------------------------------------------------
// registerStripeEvent en aislamiento — los tres estados
// ---------------------------------------------------------------------------

describe("registerStripeEvent — tres estados, no dos", () => {
  it("nunca visto → procesar sin reintento", async () => {
    expect(await registerStripeEvent({ id: "e1", type: "invoice.paid" })).toEqual({
      process: true,
      retry: false,
    });
  });

  it("visto sin terminar → procesar marcando reintento", async () => {
    await registerStripeEvent({ id: "e2", type: "invoice.paid" });
    expect(await registerStripeEvent({ id: "e2", type: "invoice.paid" })).toEqual({
      process: true,
      retry: true,
    });
  });

  it("terminado → no procesar", async () => {
    await registerStripeEvent({ id: "e3", type: "invoice.paid" });
    await markStripeEventProcessed("e3");
    expect(await registerStripeEvent({ id: "e3", type: "invoice.paid" })).toEqual({
      process: false,
      retry: false,
    });
  });

  it("markStripeEventFailed fuerza processedAt a null aunque estuviera cerrado", async () => {
    await registerStripeEvent({ id: "e4", type: "invoice.paid" });
    await markStripeEventProcessed("e4");
    await markStripeEventFailed("e4", "falló en un reintento");
    expect(store.get("e4")?.processedAt).toBeNull();
    expect(await registerStripeEvent({ id: "e4", type: "invoice.paid" })).toEqual({
      process: true,
      retry: true,
    });
  });

  it("trunca el error a 500 caracteres", async () => {
    await registerStripeEvent({ id: "e5", type: "invoice.paid" });
    await markStripeEventFailed("e5", "x".repeat(2000));
    expect(store.get("e5")?.error).toHaveLength(500);
  });

  it("un error que no es P2002 se propaga", async () => {
    // Tragarse cualquier error del `create` convertiría una caída de la base de datos en "procesa".
    (prisma.stripeEvent.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("connection refused")
    );
    await expect(registerStripeEvent({ id: "e6", type: "invoice.paid" })).rejects.toThrow(
      "connection refused"
    );
  });
});

// ---------------------------------------------------------------------------
// Firma inválida: ni fila ni efecto
// ---------------------------------------------------------------------------

describe("AC8 en la ruta — firma inválida no llega a registrar nada", () => {
  it("400 y el almacén de eventos queda vacío", async () => {
    const evento = subscriptionEvent("evt_firma_mala");
    const res = fakeRes();
    await stripeWebhookHandler(fakeReq(evento, "whsec_otro_secreto"), res as never);

    expect(res.statusCode).toBe(400);
    expect(store.size).toBe(0);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
    // El motivo NO viaja en la respuesta: sería un oráculo para quien pruebe firmas.
    expect(JSON.stringify(res.body)).not.toContain("mismatch");
  });

  it("sin STRIPE_WEBHOOK_SECRET responde 500 y no procesa", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await post(subscriptionEvent("evt_sin_secreto"));
    expect(res.statusCode).toBe(500);
    expect(store.size).toBe(0);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });
});
