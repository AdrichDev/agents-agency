import "dotenv/config";
import { prisma } from "../src/lib/db";
import { computeNextCode, parseCodeNumber } from "../src/lib/codes";

/**
 * Backfill: asigna codCliente secuencial (cli-01, cli-02...) por createdAt a los
 * clientes que aún no lo tienen. Continúa desde el máximo existente, así que es
 * idempotente y seguro de re-ejecutar.
 *
 * Run: npx tsx scripts/backfill-cod-cliente.ts
 */
async function main() {
  // Transacción: lookup del máximo + asignación en una unidad atómica.
  // El índice unique en codCliente garantiza que no se duplican códigos.
  const result = await prisma.$transaction(async (tx) => {
    const withCode = await tx.client.findMany({
      where: { codCliente: { not: null } },
      select: { codCliente: true },
    });
    let max = 0;
    for (const c of withCode) {
      const n = c.codCliente ? parseCodeNumber(c.codCliente, "cli") : null;
      if (n !== null && n > max) max = n;
    }

    const pending = await tx.client.findMany({
      where: { codCliente: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    });

    const assigned: Array<{ id: string; name: string; codCliente: string }> = [];
    let codes = withCode.map((c) => c.codCliente);
    for (const client of pending) {
      const code = computeNextCode(codes, "cli");
      await tx.client.update({ where: { id: client.id }, data: { codCliente: code } });
      codes = [...codes, code];
      assigned.push({ id: client.id, name: client.name, codCliente: code });
    }
    return assigned;
  });

  if (result.length === 0) {
    console.log("Todos los clientes ya tienen codCliente. Nada que hacer.");
  } else {
    for (const c of result) console.log(`${c.codCliente} → ${c.name} (${c.id})`);
    console.log(`Asignados ${result.length} códigos.`);
  }
}

main()
  .catch((e) => {
    console.error("Backfill error:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
