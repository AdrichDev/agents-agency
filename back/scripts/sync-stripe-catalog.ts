/**
 * H6 (aa-stripe-suscripciones, T2.3 / T2.5) — `npm run stripe:sync` y `npm run stripe:check`.
 *
 * Envoltorio de CLI, sin lógica: todo lo que decide algo vive en `@/lib/stripe/sync-catalog.ts` para
 * que se pueda ejecutar en los tests contra el doble en memoria. Aquí sólo hay entorno, salida por
 * pantalla y códigos de salida.
 *
 * Uso:
 *   npm run stripe:sync            # siembra el catálogo en Stripe (entorno según la clave)
 *   npm run stripe:sync -- --dry   # dice qué haría sin tocar Stripe ni la base de datos
 *   npm run stripe:check           # tripwire de deriva: falla si el mapa no cuadra con el catálogo
 *
 * El entorno (test / live) NO se pasa por parámetro: se deriva del prefijo de `STRIPE_SECRET_KEY`
 * (`gateway.ts`). Así no se puede sembrar producción creyendo que se está en pruebas.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { SERVICE_CATALOG } from "@/lib/service-catalog";
import { getStripeGateway } from "@/lib/stripe/gateway";
import {
  checkStripeDrift,
  isSubscriptionService,
  syncStripeCatalog,
  toCents,
} from "@/lib/stripe/sync-catalog";

function euros(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}

async function runSync(dry: boolean): Promise<number> {
  const gateway = getStripeGateway();

  if (dry) {
    // El simulacro no construye el gateway real más allá de leer su modo: no llama a Stripe.
    console.log(`[stripe:sync] SIMULACRO · entorno ${gateway.mode}`);
    for (const entry of SERVICE_CATALOG) {
      if (!isSubscriptionService(entry)) {
        console.log(`  - ${entry.id}: se salta`);
        continue;
      }
      console.log(`  + ${entry.id}: ${euros(toCents(entry.maintPrice))} / mes`);
    }
    return 0;
  }

  console.log(`[stripe:sync] entorno ${gateway.mode}`);
  const report = await syncStripeCatalog({ gateway });

  for (const s of report.skipped) {
    console.log(`  - ${s.serviceId}: ${s.reason}`);
  }

  for (const s of report.synced) {
    const nota = s.priceCreated ? "PRICE NUEVO" : "sin cambios";
    console.log(`  · ${s.serviceId}: ${euros(s.amount)}/mes · ${s.priceId} · ${nota}`);
    if (s.archivedPriceId) {
      // Lo importante de una subida de tarifa no es el `Price` nuevo: es a cuántos clientes deja
      // atrás. Si esto sale por pantalla, alguien tiene que decidir si se les migra.
      console.log(
        `      archivado ${s.archivedPriceId} · ${s.subscriptionsOnOldPrice ?? 0} suscripción(es) ` +
          `siguen en la tarifa anterior y NO se han migrado`
      );
    }
  }

  return 0;
}

async function runCheck(): Promise<number> {
  const gateway = getStripeGateway();
  const drift = await checkStripeDrift(gateway.mode);

  if (drift.length === 0) {
    console.log(`[stripe:check] entorno ${gateway.mode}: catálogo y mapa cuadran.`);
    return 0;
  }

  console.error(`[stripe:check] entorno ${gateway.mode}: DERIVA en ${drift.length} servicio(s)`);
  for (const d of drift) {
    const actual = d.mappedAmount === null ? "sin sembrar" : euros(d.mappedAmount);
    console.error(`  ! ${d.serviceId}: catálogo ${euros(d.catalogAmount)} · mapa ${actual}`);
  }
  // Código de salida distinto de cero: es un gate de despliegue, no un informe informativo.
  return 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const code = args.includes("--check")
    ? await runCheck()
    : await runSync(args.includes("--dry"));
  await prisma.$disconnect();
  process.exit(code);
}

main().catch(async (err) => {
  console.error("[stripe] error:", err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
