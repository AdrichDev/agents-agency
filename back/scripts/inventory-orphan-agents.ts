import "dotenv/config";
import { prisma } from "../src/lib/db";

/**
 * H1 (aa-metering-fail-closed, T4.1) — Inventario de agentes huérfanos (sin tenant).
 *
 * SÓLO LECTURA. No escribe nada: su función es decidir, antes de desplegar el gate
 * fail-closed, qué agentes dejarían de responder. Un agente sin `tenantId` pasa a
 * devolver 402 en todos los canales, así que los que tengan tráfico real deben recibir
 * un tenant asignado ANTES del despliegue.
 *
 * Criterio de urgencia: conversaciones NO de prueba (`isTest = false`). Un agente sin
 * tenant y sin tráfico real es un borrador y puede romperse sin consecuencias; uno con
 * conversaciones reales está en producción de facto.
 *
 * Run: npx tsx scripts/inventory-orphan-agents.ts
 */
async function main() {
  const orphans = await prisma.agent.findMany({
    where: { tenantId: null },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      createdAt: true,
      publicKey: true,
      widgetInstalledAt: true,
      widgetLastSeenAt: true,
      _count: { select: { conversations: true } },
    },
  });

  if (orphans.length === 0) {
    console.log("Sin agentes huérfanos: todos tienen tenant asignado. Despliegue seguro.");
    return;
  }

  // Conversaciones reales por agente (excluye las de la consola de pruebas).
  const realByAgent = await prisma.conversation.groupBy({
    by: ["agentId"],
    where: { isTest: false, agentId: { in: orphans.map((a) => a.id) } },
    _count: { _all: true },
  });
  const realCount = new Map(realByAgent.map((r) => [r.agentId, r._count._all]));

  const rows = orphans.map((a) => ({
    id: a.id,
    nombre: a.name,
    creado: a.createdAt.toISOString().slice(0, 10),
    convTotal: a._count.conversations,
    convReales: realCount.get(a.id) ?? 0,
    widgetInstalado: a.widgetInstalledAt ? a.widgetInstalledAt.toISOString().slice(0, 10) : "-",
    ultimoVisto: a.widgetLastSeenAt ? a.widgetLastSeenAt.toISOString().slice(0, 10) : "-",
  }));

  console.log(`\nAgentes SIN tenant: ${rows.length}\n`);
  console.table(rows);

  // Bloqueantes: los que atienden tráfico real o tienen el widget instalado en un sitio.
  const blocking = rows.filter((r) => r.convReales > 0 || r.widgetInstalado !== "-");
  if (blocking.length === 0) {
    console.log(
      "\nNinguno tiene tráfico real ni widget instalado → el fail-closed no rompe nada en uso.\n"
    );
    return;
  }

  console.log(
    `\n⚠ ${blocking.length} agente(s) huérfano(s) EN USO. Asignar tenant antes de desplegar:\n`
  );
  for (const r of blocking) {
    console.log(`  - ${r.nombre} (${r.id}) — ${r.convReales} conversaciones reales`);
  }
  console.log("");
  // Señaliza al operador que hay trabajo pendiente sin fallar como si fuese un error.
  process.exitCode = 2;
}

main()
  .catch((e) => {
    console.error("inventory-orphan-agents error:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
