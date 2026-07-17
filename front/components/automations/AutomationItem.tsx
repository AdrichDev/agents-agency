"use client";

import {
  TRIGGERS,
  INTERVALS,
  describeConfig,
  type Automation,
} from "./automationCatalog";

/**
 * Fila de una automatización en el panel. Extraída sin cambios de UI.
 */
export default function AutomationItem({
  a,
  n8nConfigured = false,
  onToggle,
  onRemove,
  onResync,
}: {
  a: Automation;
  n8nConfigured?: boolean;
  onToggle: (a: Automation) => void;
  onRemove: (id: string) => void;
  onResync: (id: string) => void;
}) {
  // Un workflow importado solo lo ejecuta n8n; el cron interno lo salta.
  const isImported = a.trigger === "imported";
  return (
    <div className="card p-4 flex items-start gap-3">
      <button
        onClick={() => onToggle(a)}
        className={`mt-0.5 w-9 h-5 rounded-full relative transition ${
          a.enabled ? "bg-neon-gradient" : "bg-white/10"
        }`}
        title={a.enabled ? "Desactivar" : "Activar"}
      >
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${a.enabled ? "left-[18px]" : "left-0.5"}`} />
      </button>
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-white">{a.name}</h3>
          <span className="chip">{TRIGGERS.find(([t]) => t === a.trigger)?.[1] ?? a.trigger}</span>
          {describeConfig(a.config) && <span className="chip">{describeConfig(a.config)}</span>}
          {a.trigger === "schedule" && a.config?.intervalMinutes && (
            <span className="chip">
              {INTERVALS.find(([m]) => m === a.config?.intervalMinutes)?.[1] ?? `Cada ${a.config.intervalMinutes} min`}
            </span>
          )}
          {/* R6-1 / T3.1: badge de modo de ejecución honesto */}
          {a.n8nWorkflowId && a.syncStatus === "synced" ? (
            <span className="chip">⚙️ n8n</span>
          ) : isImported && !n8nConfigured ? (
            // Importado con n8n apagado: el cron interno lo salta → no se ejecutará.
            <span className="chip border-amber-500/40 text-amber-300">⚠ requiere n8n (apagado)</span>
          ) : a.syncStatus === "pending" ? (
            // Automatización NL pendiente: la corre el motor interno; el estado real
            // depende de lastRunAt (distinguir "guardada sin ejecutar" de "ya corrió").
            <>
              <span className="chip">🕐 motor interno</span>
              {a.lastRunAt ? (
                <span className="chip text-slate-400">
                  última: {new Date(a.lastRunAt).toLocaleString("es-ES")}
                </span>
              ) : (
                <span className="chip text-slate-500">sin ejecutar aún</span>
              )}
            </>
          ) : (
            <span className="chip">🕐 interno</span>
          )}
          {/* R6-2: badge de error de sync */}
          {a.syncStatus === "error" && (
            <span className="chip text-amber-300">⚠ Error sync</span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1">{a.prompt}</p>
        {a.lastRunAt && (
          <p className="text-xs text-slate-600 mt-1">
            Última ejecución: {new Date(a.lastRunAt).toLocaleString("es-ES")}
          </p>
        )}
        {/* R6-3: botón reintentar sync si error */}
        {a.syncStatus === "error" && (
          <button
            onClick={() => onResync(a.id)}
            className="text-xs text-amber-400 hover:text-amber-300 mt-1 underline"
          >
            Reintentar sync
          </button>
        )}
      </div>
      <button onClick={() => onRemove(a.id)} className="text-slate-700 hover:text-red-400 text-sm">✕</button>
    </div>
  );
}
