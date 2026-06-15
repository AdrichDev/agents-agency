import { runAutomations } from "@/lib/automations/engine";

/**
 * Cron de automatizaciones (cada 5 min). Ejecuta runAutomations en background,
 * evitando solapamientos con un flag de ocupación. Devuelve el handle del
 * intervalo para poder pararlo en el apagado ordenado.
 */
export function startAutomationsCron(): NodeJS.Timeout {
  let cronBusy = false;
  return setInterval(async () => {
    if (cronBusy) return;
    cronBusy = true;
    try {
      const results = await runAutomations();
      if (results.length) console.log(`[cron] ${results.length} automatizaciones:`, results.map((r) => `${r.automation}=${r.status}`).join(", "));
    } catch (e) {
      console.error("[cron] error:", e);
    } finally {
      cronBusy = false;
    }
  }, 5 * 60 * 1000);
}
