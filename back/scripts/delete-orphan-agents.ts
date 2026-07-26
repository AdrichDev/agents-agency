import "dotenv/config";
import { prisma } from "../src/lib/db";

/**
 * H1 (aa-metering-fail-closed, T4.2) — Borrado de agentes huérfanos (sin tenant).
 *
 * DESTRUCTIVO E IRREVERSIBLE. Por eso:
 *  - por defecto hace DRY-RUN: enumera lo que arrastraría y no escribe nada;
 *  - sólo toca agentes con `tenantId = NULL` (nunca un agente de cliente, ni por error de id);
 *  - se salta los que tengan el widget instalado en un sitio real, salvo `--force`;
 *  - borra dentro de una transacción por agente.
 *
 * Borrar un Agent arrastra en cascada (onDelete: Cascade) sus conversaciones y mensajes,
 * leads, knowledge, skills, integraciones, automatizaciones, canales y servicios.
 * NO arrastra `uso_tokens`: `TokenUsage.agentId` es un escalar opcional sin relación a
 * Agent (schema.prisma), así que el histórico de consumo se conserva intacto.
 *
 * Uso:
 *   npx tsx scripts/delete-orphan-agents.ts                      # dry-run de todos
 *   npx tsx scripts/delete-orphan-agents.ts --id=abc,def         # dry-run acotado
 *   npx tsx scripts/delete-orphan-agents.ts --id=abc --apply     # borra esos
 *   npx tsx scripts/delete-orphan-agents.ts --all --apply        # borra TODOS los huérfanos
 */
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ALL = args.includes("--all");
const FORCE = args.includes("--force");
const idArg = args.find((a) => a.startsWith("--id="));
const ONLY_IDS = idArg
  ? idArg
      .slice("--id=".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

async function main() {
  // Un borrado masivo tiene que pedirse a propósito: `--apply` a secas, sin decir sobre qué,
  // es el error irreversible fácil de cometer.
  if (APPLY && !ONLY_IDS && !ALL) {
    console.error(
      "\n✗ --apply sin --id borraría TODOS los agentes huérfanos.\n" +
        "  Acota con --id=<id,id> o confirma explícitamente con --all.\n"
    );
    process.exitCode = 1;
    return;
  }

  const orphans = await prisma.agent.findMany({
    where: { tenantId: null, ...(ONLY_IDS ? { id: { in: ONLY_IDS } } : {}) },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      createdAt: true,
      widgetInstalledAt: true,
      _count: {
        select: {
          conversations: true,
          leads: true,
          knowledge: true,
          skills: true,
          integrations: true,
          automations: true,
          channelConnections: true,
          services: true,
        },
      },
    },
  });

  if (ONLY_IDS) {
    // Un id que no aparece es un id que NO cumple el filtro de seguridad: o no existe, o
    // tiene tenant. Avisar explícitamente en vez de borrar en silencio lo que sí encaja.
    const found = new Set(orphans.map((a) => a.id));
    const missing = ONLY_IDS.filter((id) => !found.has(id));
    if (missing.length > 0) {
      console.error(
        `\n✗ Estos ids no son agentes huérfanos (no existen o tienen tenant asignado):\n` +
          missing.map((id) => `   - ${id}`).join("\n") +
          `\nAbortado sin tocar nada.\n`
      );
      process.exitCode = 1;
      return;
    }
  }

  if (orphans.length === 0) {
    console.log("Sin agentes huérfanos que coincidan. Nada que hacer.");
    return;
  }

  console.log(`\n${APPLY ? "BORRANDO" : "DRY-RUN (no se escribe nada)"} — ${orphans.length} agente(s)\n`);

  let deleted = 0;
  for (const a of orphans) {
    const messages = await prisma.message.count({ where: { conversation: { agentId: a.id } } });
    const c = a._count;
    const arrastra = [
      `${c.conversations} conversaciones`,
      `${messages} mensajes`,
      `${c.leads} leads`,
      `${c.knowledge} chunks`,
      `${c.skills} skills`,
      `${c.integrations} integraciones`,
      `${c.automations} automatizaciones`,
      `${c.channelConnections} canales`,
      `${c.services} servicios`,
    ].join(", ");

    console.log(`• ${a.name} (${a.id}) — creado ${a.createdAt.toISOString().slice(0, 10)}`);
    console.log(`  arrastra: ${arrastra}`);

    if (a.widgetInstalledAt && !FORCE) {
      console.log(
        `  ⏭  SALTADO: widget instalado el ${a.widgetInstalledAt.toISOString().slice(0, 10)} ` +
          `→ está embebido en un sitio real. Usa --force si de verdad quieres borrarlo.\n`
      );
      continue;
    }

    if (!APPLY) {
      console.log("  (dry-run)\n");
      continue;
    }

    await prisma.$transaction(async (tx) => {
      // Re-comprobar el tenant dentro de la transacción: si alguien lo asignó mientras
      // corría el script, no se borra un agente que ya es de un cliente.
      const fresh = await tx.agent.findUnique({ where: { id: a.id }, select: { tenantId: true } });
      if (!fresh) throw new Error(`agente ${a.id} ya no existe`);
      if (fresh.tenantId) throw new Error(`agente ${a.id} tiene tenant asignado: no se borra`);
      await tx.agent.delete({ where: { id: a.id } });
    });
    deleted++;
    console.log("  ✓ borrado\n");
  }

  if (APPLY) {
    console.log(`Borrados ${deleted} de ${orphans.length} agente(s).\n`);
  } else {
    console.log("Dry-run terminado. Añade --apply para ejecutar el borrado.\n");
  }
}

main()
  .catch((e) => {
    console.error("delete-orphan-agents error:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
