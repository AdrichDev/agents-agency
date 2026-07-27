import "dotenv/config";
import { prisma } from "../src/lib/db";
import { resolveCurrentPeriod, nextPeriodStart } from "../src/lib/billing-period";

/**
 * H4 (aa-planes-y-cuotas, T3.4) — Reconciliación del contador de periodo contra `uso_tokens`.
 *
 * SÓLO LECTURA. No escribe nada, no corrige nada. Corregir automáticamente sería lo peor que
 * podría hacer: `tokensUsedPeriod` es la caché con la que se corta el servicio, y un script que
 * la "arregla" solo puede tanto devolver cuota que no toca como quitarla a quien está al día. La
 * decisión es del propietario, con la desviación delante.
 *
 * Por qué existe: `uso_tokens` es la fuente de verdad del consumo (una fila por respuesta) y
 * `tenant.tokens_usados_periodo` es un agregado que se mantiene incrementalmente. Todo agregado
 * incremental deriva antes o después —una transacción que falla, una renovación que cae en medio
 * de un descuento, un backfill— y la única forma de saberlo es recomputarlo.
 *
 * Qué compara, para cada tenant:
 *   contador  = tenant.tokens_usados_periodo
 *   esperado  = SUM(uso_tokens.tokens) del periodo vigente, SÓLO modo "platform"
 *
 * "Sólo platform" no es un detalle: en byok se registra la fila de consumo pero NO se incrementa
 * el contador (el cliente paga a su proveedor y no hay cupo que consumir). Sumar las filas de
 * byok daría una desviación falsa en todo tenant que haya traído su clave.
 *
 * El periodo vigente se calcula con la MISMA función que usa el gate (`resolveCurrentPeriod`), no
 * con una copia: si aquí se recalculara el periodo con otra aritmética, el script mediría un
 * periodo distinto al que se cobra y sus desviaciones no significarían nada.
 *
 * Run: npx tsx scripts/reconcile-quota.ts   (npm run reconcile:quota)
 */

const iso = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

async function main() {
  const now = new Date();
  const tenants = await prisma.tenant.findMany({
    orderBy: [{ codigo: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      codigo: true,
      name: true,
      isActive: true,
      credentialMode: true,
      tokenBalance: true,
      tokensUsed: true,
      tokensUsedPeriod: true,
      periodStart: true,
      periodAnchorDay: true,
    },
  });

  if (tenants.length === 0) {
    console.log("No hay tenants.");
    return;
  }

  const rows: string[] = [];
  let drifted = 0;
  let pendingRenewal = 0;

  for (const t of tenants) {
    // Periodo VIGENTE según la misma regla del gate. Si `renewed` es true, este tenant tiene el
    // periodo vencido y todavía no lo ha renovado (no ha llegado ningún mensaje desde que
    // caducó): su contador es del periodo ANTERIOR, así que compararlo contra la suma del
    // periodo vigente daría una desviación inventada. Se marca y no se cuenta como deriva.
    const { periodStart, renewed } = resolveCurrentPeriod(t, now);
    const periodEnd = nextPeriodStart(periodStart, t.periodAnchorDay);

    const agg = await prisma.tokenUsage.aggregate({
      _sum: { tokens: true },
      where: {
        tenantId: t.id,
        credentialMode: "platform",
        createdAt: { gte: periodStart, lt: periodEnd },
      },
    });
    const expected = agg._sum.tokens ?? 0;
    const counter = t.tokensUsedPeriod;
    const delta = counter - expected;

    let flag = "OK";
    if (renewed) {
      flag = "RENOVACION PENDIENTE";
      pendingRenewal += 1;
    } else if (delta !== 0) {
      flag = "DERIVA";
      drifted += 1;
    }

    rows.push(
      [
        (t.codigo ?? "-").padEnd(8),
        t.name.slice(0, 24).padEnd(24),
        t.credentialMode.padEnd(8),
        iso(periodStart).padEnd(17),
        String(counter).padStart(10),
        String(expected).padStart(10),
        String(delta).padStart(9),
        String(t.tokenBalance).padStart(11),
        flag,
      ].join("  ")
    );
  }

  console.log("");
  console.log(
    [
      "CODIGO  ".padEnd(8),
      "NOMBRE".padEnd(24),
      "MODO".padEnd(8),
      "PERIODO DESDE".padEnd(17),
      "CONTADOR".padStart(10),
      "ESPERADO".padStart(10),
      "DELTA".padStart(9),
      "CUPO".padStart(11),
      "ESTADO",
    ].join("  ")
  );
  console.log("-".repeat(120));
  rows.forEach((r) => console.log(r));
  console.log("-".repeat(120));
  console.log(
    `Tenants: ${tenants.length} | con deriva: ${drifted} | con renovacion pendiente: ${pendingRenewal}`
  );
  console.log("");
  console.log(
    "DELTA > 0: el contador cobra mas de lo consumido (el cliente pierde cuota que no gasto)."
  );
  console.log(
    "DELTA < 0: el contador cobra menos (consumo servido que no descuenta del cupo — fuga)."
  );
  console.log(
    "RENOVACION PENDIENTE: periodo vencido sin trafico posterior. El contador es del periodo"
  );
  console.log(
    "  anterior y se pondra a cero en el primer mensaje. No es deriva; no se compara.",
  );
  console.log("");
  console.log("Este script NO corrige nada. Ver openspec aa-planes-y-cuotas T3.4.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
