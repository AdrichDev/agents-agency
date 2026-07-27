/**
 * H6 (aa-stripe-suscripciones, T1.4) — El estado de Stripe no comparte columna con el kill switch.
 *
 * Test de esquema y de migración, no de comportamiento: los manejadores de webhook no existen todavía
 * (T4) y el corte por impago tampoco (T5). Lo que se fija aquí es la FORMA que hace posible la regla
 * de design §D3, porque una vez aplicada la migración ya no se puede cambiar de opinión gratis.
 *
 * Las dos cosas que este fichero defiende:
 *
 *   1. `estado_suscripcion` existe como columna propia y NULLABLE SIN DEFAULT. Si alguien le pone
 *      `DEFAULT 'unpaid'` "para que sea fail-closed como el resto", los 15 tenants de producción se
 *      quedan mudos a la vez el día del despliegue: ninguno tiene suscripción todavía. El fail-closed
 *      de H1 lo siguen sosteniendo `activo` y el cupo, que esta migración no toca.
 *
 *   2. La migración es ADITIVA y no roza `activo`. `activo` es la decisión humana; en cuanto un
 *      webhook pueda escribirla, un `invoice.paid` deshace una suspensión manual sin dejar rastro.
 *
 * AC5 ("ningún manejador escribe `isActive`") NO se puede verificar aquí: no hay manejadores que leer,
 * y un test que escanease un directorio inexistente pasaría en vacío — que es peor que no tenerlo.
 * Va en T4, cuando exista el código que debe cumplirlo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Prisma } from "@/lib/generated/prisma/client";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const MIGRATION_URL = new URL(
  "../prisma/migrations/20260727060000_stripe_estado_suscripcion/migration.sql",
  import.meta.url
);
const migration = readFileSync(MIGRATION_URL, "utf8");

/** Cuerpo de un modelo, sin las líneas `///` de cabecera (que sí nombran `isActive` al explicarse). */
function modelBody(name: string): string {
  const m = schema.match(new RegExp(`\\nmodel ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`modelo ${name} no encontrado en schema.prisma`);
  return m[1];
}

describe("T1.4 — los ficheros que este test compara existen", () => {
  // Mismo criterio que el tripwire del catálogo: un test que no encuentra lo que compara debe caer
  // aquí, no pasar en silencio dando la impresión de que hay red.
  it("la migración de T1.3 sigue donde se espera", () => {
    expect(migration.length).toBeGreaterThan(0);
  });
});

describe("T1.1 — `Tenant` gana el estado de Stripe sin fundirlo con `activo`", () => {
  const body = modelBody("Tenant");

  it("`isActive` sigue existiendo y sigue siendo el mismo booleano", () => {
    // Si esta línea cambia, la separación de §D3 pierde sentido: no hay dos columnas, hay una nueva.
    expect(body).toMatch(/isActive\s+Boolean\s+@default\(true\)\s+@map\("activo"\)/);
  });

  it("`subscriptionStatus` es nullable y mapea a `estado_suscripcion`", () => {
    expect(body).toMatch(/subscriptionStatus\s+String\?\s+@map\("estado_suscripcion"\)/);
  });

  it("`subscriptionStatus` NO tiene default", () => {
    // El default es justo lo que convertiría "no consta que pague" en "no paga". `null` significa
    // SIN SUSCRIPCIÓN y no debe cortar a nadie.
    const linea = body.split("\n").find((l) => l.includes("subscriptionStatus"))!;
    expect(linea).not.toMatch(/@default/);
  });

  it("los ids de Stripe son nullable y unique", () => {
    // Unique porque un webhook llega identificado sólo por el customer/subscription: dos tenants con
    // el mismo customer harían que un cobro moviera el estado del cliente equivocado.
    expect(body).toMatch(/stripeCustomerId\s+String\?\s+@unique\s+@map\("stripe_cliente_id"\)/);
    expect(body).toMatch(
      /stripeSubscriptionId\s+String\?\s+@unique\s+@map\("stripe_suscripcion_id"\)/
    );
  });

  it("`Tenant` no gana ninguna columna de importe", () => {
    // El importe vive en el catálogo y lo ejecuta Stripe (§D1). Un `precio` aquí sería la tercera
    // copia del mismo número.
    const monetario = /precio|price|importe|amount|tarifa|coste/i;
    const campos = body
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter((l) => l && !l.startsWith("@@"))
      .map((l) => l.split(/\s+/)[0]);
    expect(campos.filter((c) => monetario.test(c))).toEqual([]);
  });
});

describe("T1.2 — `StripeEvent` tiene la forma que exige la idempotencia (§D5)", () => {
  const body = modelBody("StripeEvent");

  it("`id` es la clave y NO se genera aquí", () => {
    // La pone Stripe (`evt_...`). Un `@default(cuid())` haría que cada entrega del mismo evento
    // creara una fila nueva, y la idempotencia dejaría de existir sin que ningún test lo notara.
    expect(body).toMatch(/id\s+String\s+@id/);
    expect(body.split("\n").find((l) => /\bid\s+String/.test(l))!).not.toMatch(/@default/);
  });

  it("`processedAt` es nullable — distingue 'visto' de 'terminado'", () => {
    // Sin nullable no hay forma de reintentar un fallo transitorio: la fila existiría y el reintento
    // se descartaría como duplicado.
    expect(body).toMatch(/processedAt\s+DateTime\?\s+@map\("procesado_en"\)/);
  });

  it("guarda el motivo del último fallo", () => {
    expect(body).toMatch(/error\s+String\?/);
  });
});

describe("T1.2 — `StripePriceMap` separa test de live (§D2)", () => {
  const body = modelBody("StripePriceMap");

  it("la clave es compuesta `(serviceId, mode)`", () => {
    // Los ids de Stripe son distintos por entorno. Con `serviceId` solo, un `stripe:sync` en test
    // pisaría los ids de producción.
    expect(body).toMatch(/@@id\(\[serviceId, mode\]\)/);
  });

  it("`priceId` es unique", () => {
    expect(body).toMatch(/@@unique\(\[priceId\]\)/);
  });

  it("guarda el importe en céntimos, como espejo del catálogo", () => {
    // Aquí SÍ hay un importe, y es la única excepción del eje: es una copia declarada para que el
    // tripwire de deriva no tenga que llamar a la API por cada servicio. La fuente sigue siendo
    // `front/lib/service-catalog.json`.
    expect(body).toMatch(/amount\s+Int\s+@map\("importe_centimos"\)/);
  });
});

describe("T1.3 — la migración es aditiva y no toca `activo`", () => {
  it("añade las tres columnas al tenant", () => {
    expect(migration).toMatch(/ALTER TABLE "tenant" ADD COLUMN "estado_suscripcion" TEXT;/);
    expect(migration).toMatch(/ALTER TABLE "tenant" ADD COLUMN "stripe_cliente_id" TEXT;/);
    expect(migration).toMatch(/ALTER TABLE "tenant" ADD COLUMN "stripe_suscripcion_id" TEXT;/);
  });

  it("`estado_suscripcion` no lleva DEFAULT ni NOT NULL", () => {
    // El punto entero de la columna: `null` = sin suscripción, y no corta. Un DEFAULT 'unpaid' o un
    // NOT NULL obligaría a inventar un estado de pago para 15 clientes que están sirviendo tráfico.
    const add = migration.match(/ADD COLUMN "estado_suscripcion"[^;]*/)![0];
    expect(add).not.toMatch(/DEFAULT/i);
    expect(add).not.toMatch(/NOT NULL/i);
  });

  it("no escribe ni una fila: sin UPDATE, sin INSERT, sin backfill", () => {
    expect(migration).not.toMatch(/\bUPDATE\s+"?tenant/i);
    expect(migration).not.toMatch(/\bINSERT\s+INTO/i);
  });

  it("no roza la columna `activo`", () => {
    // `activo` es la decisión humana. Esta migración no la modifica, no le cambia el default y no la
    // renombra: si algún día un webhook puede escribirla, un `invoice.paid` deshace una suspensión
    // manual sin dejar rastro.
    expect(migration).not.toMatch(/ALTER COLUMN "activo"/i);
    expect(migration).not.toMatch(/DROP COLUMN "activo"/i);
  });

  it("crea las dos tablas con su clave", () => {
    expect(migration).toMatch(/CREATE TABLE "stripe_evento"/);
    expect(migration).toMatch(/CONSTRAINT "stripe_evento_pkey" PRIMARY KEY \("id"\)/);
    expect(migration).toMatch(/CREATE TABLE "stripe_precio_mapa"/);
    expect(migration).toMatch(
      /CONSTRAINT "stripe_precio_mapa_pkey" PRIMARY KEY \("servicio_id", "modo"\)/
    );
  });
});

describe("T1.5 — el cliente de Prisma conoce los campos nuevos", () => {
  it("`TenantUpdateInput` acepta el estado de suscripción", () => {
    // Comprobación de TIPOS, la verifica `tsc` además de vitest: si el cliente generado no tuviera
    // los campos, este fichero no compilaría. Cubre el caso de haber editado el schema y olvidado
    // `prisma generate`.
    const patch: Prisma.TenantUpdateInput = {
      subscriptionStatus: "past_due",
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test",
    };
    expect(patch.subscriptionStatus).toBe("past_due");
  });

  it("`isActive` sigue siendo un campo aparte del mismo input", () => {
    const patch: Prisma.TenantUpdateInput = { isActive: false, subscriptionStatus: "active" };
    // La combinación que da sentido a §D3: suspendido a mano Y pagando. Si fuera una sola columna,
    // este estado sería inexpresable.
    expect(patch.isActive).toBe(false);
    expect(patch.subscriptionStatus).toBe("active");
  });
});
