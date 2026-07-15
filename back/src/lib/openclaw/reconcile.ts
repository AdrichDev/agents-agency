/**
 * Reconciliación periódica BD ↔ OpenClaw (aa-openclaw-provision-hardening).
 *
 * El sync por evento (create/update/delete) es fail-soft: si el gateway está
 * caído en ese momento, BD y OpenClaw divergen en silencio (agente "failed"
 * para siempre, huérfanos aa-* tras un delete, lista pisada por un restart
 * del contenedor). Este cron cierra esos agujeros: cada tick re-aprovisiona
 * los agentes runtime="openclaw" que falten, retira los huérfanos y refresca
 * el estado persistido (ecommerceConfig.openclawProvisioning) cuando cambia.
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import * as adminRpc from "@/lib/openclaw/admin-rpc";
import { reconcileAgentsProvisioning } from "@/lib/openclaw/provision";

const RECONCILE_INTERVAL_MS = Number(process.env.OPENCLAW_RECONCILE_INTERVAL_MS ?? 10 * 60 * 1000);

/** Una pasada de reconciliación. Exportada para el test y para invocación manual. */
export async function reconcileOpenclawAgents(): Promise<void> {
  if (!adminRpc.isConfigured()) return; // noop: sin gateway configurado no hay nada que reconciliar

  const agents = await prisma.agent.findMany({
    where: { runtime: "openclaw" },
    select: { id: true, name: true, systemPrompt: true, runtime: true, temperature: true, ecommerceConfig: true },
  });

  const result = await reconcileAgentsProvisioning(agents);
  if (!result.ok) {
    logger.warn(`[openclaw-reconcile] skipped: ${result.reason}`);
    return;
  }

  let updated = 0;
  for (const state of result.states) {
    const agent = agents.find((a) => a.id === state.agentId);
    if (!agent) continue;
    const ecomCfg = ((agent.ecommerceConfig as Record<string, unknown> | null) ?? {}) as Record<string, any>;
    const previous = ecomCfg.openclawProvisioning?.status;
    if (previous === state.provisionState) continue; // sin cambio → no tocar la fila

    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        ecommerceConfig: {
          ...ecomCfg,
          openclawProvisioning: {
            status: state.provisionState,
            checkedAt: new Date().toISOString(),
            pendingRestart: state.provisionState !== "provisioned",
            ...(state.reason ? { reason: state.reason } : {}),
          },
        },
      } as any,
    });
    updated++;
  }

  if (updated || result.removedOrphans.length) {
    logger.info(
      `[openclaw-reconcile] agents=${result.states.length} statusUpdated=${updated} orphansRemoved=${result.removedOrphans.length}`
    );
  }
}

/**
 * Arranca el cron de reconciliación (cada 10 min por defecto; tunable via
 * OPENCLAW_RECONCILE_INTERVAL_MS). Mismo patrón que startAutomationsCron:
 * flag de ocupación anti-solape y handle devuelto para el apagado ordenado.
 */
export function startOpenclawReconcileCron(): NodeJS.Timeout {
  let busy = false;
  return setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await reconcileOpenclawAgents();
    } catch (e) {
      logger.error({ err: e }, "[openclaw-reconcile] error:");
    } finally {
      busy = false;
    }
  }, RECONCILE_INTERVAL_MS);
}
