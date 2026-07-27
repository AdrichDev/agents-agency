/**
 * H6 (aa-stripe-suscripciones, T6.4) — E9, E10 y E12: el importe lo pone el servidor.
 *
 * El ataque que esto defiende es el primero que se prueba contra cualquier checkout: mandar el importe
 * en el cuerpo. Aquí se comprueba por los dos lados —que el cuerpo con `amount` se rechaza, y que lo
 * que llega a Stripe sale del mapa de precios y del recuento de agentes— porque cada uno solo cubre la
 * mitad. Un endpoint que rechazara `amount` pero leyera `quantity` del body seguiría siendo vulnerable.
 *
 * El doble de Stripe es el mismo `FakeStripeGateway` de T2, así que la lógica de `checkout.ts` se
 * ejecuta de verdad: no hay ningún `vi.fn()` devolviendo la sesión ya hecha.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findUnique: vi.fn(), update: vi.fn() },
    stripePriceMap: { findUnique: vi.fn() },
    agent: { count: vi.fn() },
  },
}));

// Mock PARCIAL: `getStripeGateway` se dobla porque sin `STRIPE_SECRET_KEY` lanza, pero todo lo demás
// —`productIdFor`, `resolveStripeMode`— es real. El doble que devuelve es el `FakeStripeGateway`, no
// un `vi.fn()`: lo que se quiere comprobar es qué argumentos recibe Stripe.
vi.mock("@/lib/stripe/gateway", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/stripe/gateway")>();
  return { ...actual, getStripeGateway: () => gateway };
});

import { prisma } from "@/lib/db";
import { billableAgentFilter, type AgentStatus } from "@/lib/agent/lifecycle";
import { FakeStripeGateway } from "./helpers/fake-stripe";
import { startSubscriptionCheckout } from "@/lib/stripe/checkout";
import { SERVICE_CATALOG } from "@/lib/service-catalog";
import { clientsRouter } from "@/routes/clients";
import { errorHandler } from "@/lib/observability";
import type { SessionUser } from "@/lib/auth";

let gateway: FakeStripeGateway;

const TENANT_ID = "ten_checkout";
const SERVICIO = "chatbot_plus";
const FRONT = "https://panel.3aestudio.es";

const mTenantFind = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const mTenantUpdate = prisma.tenant.update as ReturnType<typeof vi.fn>;
const mPriceMap = prisma.stripePriceMap.findUnique as ReturnType<typeof vi.fn>;
const mAgentCount = prisma.agent.count as ReturnType<typeof vi.fn>;

/** Importe del catálogo, en céntimos. NO se escribe a mano: el precio vive en un solo sitio. */
function centimosDe(serviceId: string): number {
  const entry = SERVICE_CATALOG.find((s) => s.id === serviceId);
  if (!entry) throw new Error(`servicio ${serviceId} no está en el catálogo`);
  return Math.round(entry.maintPrice * 100);
}

/**
 * Siembra el `Price` del servicio en el doble y devuelve su id, dejándolo también en el mapa.
 * Es el estado que deja `npm run stripe:sync`.
 */
async function sembrarPrecio(serviceId = SERVICIO): Promise<string> {
  const entry = SERVICE_CATALOG.find((s) => s.id === serviceId)!;
  const productId = await gateway.ensureProduct({
    serviceId,
    name: entry.name,
    description: entry.description,
  });
  const priceId = await gateway.createRecurringPrice({
    productId,
    amount: centimosDe(serviceId),
    currency: "eur",
  });
  mPriceMap.mockResolvedValue({ priceId });
  gateway.resetCalls();
  return priceId;
}

/** `agent.count` real sobre una lista en memoria, aplicando el filtro facturable de verdad. */
function conAgentes(estados: AgentStatus[]) {
  mAgentCount.mockImplementation(async ({ where }: { where: ReturnType<typeof billableAgentFilter> }) => {
    expect(where).toEqual(billableAgentFilter(TENANT_ID));
    const permitidos = where.status.in;
    return estados.filter((e) => permitidos.includes(e)).length;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  gateway = new FakeStripeGateway("test");
  mTenantFind.mockResolvedValue({
    id: TENANT_ID,
    name: "Negocio de prueba",
    email: "cliente@negocio.es",
    stripeCustomerId: null,
  });
  mTenantUpdate.mockResolvedValue({ id: TENANT_ID });
  conAgentes(["published", "published"]);
});

// ---------------------------------------------------------------------------
// E9 (AC11) — el precio no viene del navegador
// ---------------------------------------------------------------------------

describe("E9 (AC11) — el importe y la cantidad los pone el servidor", () => {
  it("la sesión se crea con el priceId del mapa y la quantity contada", async () => {
    const priceId = await sembrarPrecio();

    const result = await startSubscriptionCheckout({
      tenantId: TENANT_ID,
      serviceId: SERVICIO,
      gateway,
      frontUrl: FRONT,
    });

    const enviado = gateway.lastCheckout()!;
    expect(enviado.priceId).toBe(priceId);
    expect(enviado.quantity).toBe(2);
    expect(result.url).toContain("checkout.stripe.test");
  });

  it("el importe cobrado es el del catálogo × agentes, sin pasar por ningún parámetro", async () => {
    const priceId = await sembrarPrecio();
    const result = await startSubscriptionCheckout({
      tenantId: TENANT_ID,
      serviceId: SERVICIO,
      gateway,
      frontUrl: FRONT,
    });
    // 99 € × 2 agentes. La cifra sale del catálogo, no está escrita aquí.
    expect(gateway.checkoutTotal(result.id)).toBe(centimosDe(SERVICIO) * 2);
    expect(gateway.prices.find((p) => p.id === priceId)!.amount).toBe(centimosDe(SERVICIO));
  });

  it("la firma de startSubscriptionCheckout no admite importe ni cantidad", () => {
    // Test estructural, y es el que de verdad cierra §D7: si el parámetro no existe, no hay nada que
    // validar más adentro ni nada que alguien pueda olvidar comprobar en un refactor.
    const fuente = startSubscriptionCheckout.toString();
    expect(fuente).not.toMatch(/\bamount\b/);
    expect(fuente).not.toMatch(/\bquantity:\s*input/);
  });

  it("los metadatos llevan el tenant, que es como el webhook lo resuelve", async () => {
    await sembrarPrecio();
    await startSubscriptionCheckout({
      tenantId: TENANT_ID,
      serviceId: SERVICIO,
      gateway,
      frontUrl: FRONT,
    });
    const enviado = gateway.lastCheckout()!;
    expect(enviado.tenantId).toBe(TENANT_ID);
    expect(enviado.serviceId).toBe(SERVICIO);
  });

  it("sin fila en StripePriceMap falla en cerrado y dice qué ejecutar", async () => {
    mPriceMap.mockResolvedValue(null);
    await expect(
      startSubscriptionCheckout({ tenantId: TENANT_ID, serviceId: SERVICIO, gateway, frontUrl: FRONT })
    ).rejects.toThrow(/stripe:sync/);
    // Crear el Price al vuelo sería sembrar tarifas en Stripe desde un alta cualquiera.
    expect(gateway.calls.createPrice).toBe(0);
    expect(gateway.calls.createCheckout).toBe(0);
  });

  it("un servicio que no es suscripción se rechaza", async () => {
    // `tokens_5m` tiene maintPrice > 0 y colaría en un filtro ingenuo, creando una suscripción mensual
    // a un pack que se vende una vez.
    await expect(
      startSubscriptionCheckout({ tenantId: TENANT_ID, serviceId: "tokens_5m", gateway, frontUrl: FRONT })
    ).rejects.toThrow(/no es una suscripción/);
    expect(gateway.calls.createCheckout).toBe(0);
  });

  it("un serviceId inventado se rechaza", async () => {
    await expect(
      startSubscriptionCheckout({ tenantId: TENANT_ID, serviceId: "chatbot_gratis", gateway, frontUrl: FRONT })
    ).rejects.toThrow(/desconocido/);
  });
});

// ---------------------------------------------------------------------------
// Customer: uno por cliente
// ---------------------------------------------------------------------------

describe("el Customer de Stripe se guarda y se reutiliza", () => {
  it("se persiste antes de abrir la sesión", async () => {
    await sembrarPrecio();
    await startSubscriptionCheckout({ tenantId: TENANT_ID, serviceId: SERVICIO, gateway, frontUrl: FRONT });

    expect(mTenantUpdate).toHaveBeenCalledTimes(1);
    const escrito = mTenantUpdate.mock.calls[0][0].data.stripeCustomerId;
    expect(escrito).toMatch(/^cus_/);
    expect(gateway.customers.get(escrito)!.tenantId).toBe(TENANT_ID);
  });

  it("un segundo intento no crea otro Customer", async () => {
    // Sin esto, cada checkout abandonado dejaría un `Customer` más y el historial del cliente acabaría
    // partido en varios.
    await sembrarPrecio();
    await startSubscriptionCheckout({ tenantId: TENANT_ID, serviceId: SERVICIO, gateway, frontUrl: FRONT });
    const existente = mTenantUpdate.mock.calls[0][0].data.stripeCustomerId;

    mTenantFind.mockResolvedValue({
      id: TENANT_ID,
      name: "Negocio de prueba",
      email: "cliente@negocio.es",
      stripeCustomerId: existente,
    });
    mTenantUpdate.mockClear();

    await startSubscriptionCheckout({ tenantId: TENANT_ID, serviceId: SERVICIO, gateway, frontUrl: FRONT });
    expect(gateway.customers.size).toBe(1);
    expect(mTenantUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// E10 (AC13) — sólo lo facturable cuenta
// ---------------------------------------------------------------------------

describe("E10 (AC13) — quantity = agentes facturables", () => {
  /**
   * CORRECCIÓN DE LA PREMISA DE E10. El escenario decía "2 publicados, 1 en `draft` y 1 con
   * `isTest = true`". Los agentes **no tienen** `isTest`: ese campo está en `Conversation`
   * (`schema.prisma:579`), y marca la conversación de la consola de pruebas del operador, no el
   * agente. Escrito tal cual, el test habría filtrado por una propiedad inexistente — es decir,
   * habría contado 3 y habría pasado igual con un filtro roto.
   *
   * Lo que sí decide el recuento es `status`, vía `BILLABLE_STATUSES = ["published", "suspended"]`.
   */
  it("2 publicados + 1 draft + 1 archivado → quantity 2", async () => {
    await sembrarPrecio();
    conAgentes(["published", "published", "draft", "archived"]);

    await startSubscriptionCheckout({ tenantId: TENANT_ID, serviceId: SERVICIO, gateway, frontUrl: FRONT });
    expect(gateway.lastCheckout()!.quantity).toBe(2);
  });

  it("un suspendido SÍ cuenta: sigue ocupando su plaza", async () => {
    await sembrarPrecio();
    conAgentes(["published", "suspended"]);
    await startSubscriptionCheckout({ tenantId: TENANT_ID, serviceId: SERVICIO, gateway, frontUrl: FRONT });
    expect(gateway.lastCheckout()!.quantity).toBe(2);
  });

  it("sin ningún agente facturable no se abre checkout", async () => {
    // Una suscripción de 0 € que después habría que corregir a mano en cuanto publicaran el primero.
    await sembrarPrecio();
    conAgentes(["draft", "draft"]);
    await expect(
      startSubscriptionCheckout({ tenantId: TENANT_ID, serviceId: SERVICIO, gateway, frontUrl: FRONT })
    ).rejects.toThrow(/agente facturable/);
    expect(gateway.calls.createCheckout).toBe(0);
  });

  it("usa el filtro facturable real, no una copia", async () => {
    // La aserción vive dentro de `conAgentes`: si `checkout.ts` contara con otro `where`, falla.
    await sembrarPrecio();
    await startSubscriptionCheckout({ tenantId: TENANT_ID, serviceId: SERVICIO, gateway, frontUrl: FRONT });
    expect(mAgentCount).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// La ruta: `.strict()` y el gate de rol
// ---------------------------------------------------------------------------

const staff: SessionUser = {
  id: "u-staff",
  firstName: "Adrián",
  lastName: "Estudio",
  email: "staff@3aestudio.es",
  role: "admin",
  tenantId: null,
};

const cliente: SessionUser = {
  id: "u-cliente",
  firstName: "Ana",
  lastName: "Cliente",
  email: "ana@negocio.es",
  role: "client",
  tenantId: TENANT_ID,
};

function post(
  payload: unknown,
  user: SessionUser | null = staff
): Promise<{ status: number; body: any }> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use("/api/clients", clientsRouter);
  app.use(errorHandler);

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const data = JSON.stringify(payload);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path: `/api/clients/${TENANT_ID}/subscription/checkout`,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(Buffer.byteLength(data)),
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            server.close();
            resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null });
          });
        }
      );
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      req.write(data);
      req.end();
    });
  });
}

describe("E9 en la ruta (AC11) — `.strict()` convierte el amount colado en un 400", () => {
  it("un cuerpo con amount y quantity se rechaza y no llega a Stripe", async () => {
    await sembrarPrecio();
    const res = await post({ serviceId: SERVICIO, amount: 1, quantity: 99 });

    expect(res.status).toBe(400);
    // Lo importante no es el 400 en sí: es que no se abrió ninguna sesión. Con el Zod por defecto
    // (que descarta las claves desconocidas en silencio) esto habría sido un 201, y quien lo probara
    // habría concluido —razonablemente— que el campo se aceptó.
    expect(gateway.calls.createCheckout).toBe(0);
  });

  it("el cuerpo limpio sí crea la sesión", async () => {
    await sembrarPrecio();
    const res = await post({ serviceId: SERVICIO });
    expect(res.status).toBe(201);
    expect(res.body.url).toContain("checkout.stripe.test");
    expect(gateway.lastCheckout()!.quantity).toBe(2);
  });

  it("sin serviceId también es 400", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });
});

describe("E12 (AC12) — el cliente no cobra", () => {
  it("un usuario con rol client recibe 403 en su propio tenant", async () => {
    await sembrarPrecio();
    const res = await post({ serviceId: SERVICIO }, cliente);

    expect(res.status).toBe(403);
    expect(gateway.calls.createCheckout).toBe(0);
  });

  it("sin sesión es 401", async () => {
    const res = await post({ serviceId: SERVICIO }, null);
    expect(res.status).toBe(401);
  });

  it("el rol se comprueba ANTES que el cuerpo", async () => {
    // Un 400 aquí le confirmaría a un `client` que el endpoint existe y qué forma tiene su cuerpo.
    const res = await post({ serviceId: SERVICIO, amount: 1 }, cliente);
    expect(res.status).toBe(403);
  });
});
