"use client";

/**
 * Pestaña "Skills" del detalle de agente: lista de skills instaladas con su
 * estado. Extraída de la página sin cambios de UI.
 */
export default function SkillsTab({
  agent,
  onGoToIntegrations,
}: {
  agent: any;
  onGoToIntegrations: () => void;
}) {
  return (
    <div className="card p-6 space-y-4">
      <h3 className="font-semibold text-sm text-white">Skills instaladas</h3>
      {(!agent.skillStatus || agent.skillStatus.length === 0) ? (
        <p className="text-xs text-slate-500">Este agente no tiene skills asignadas.</p>
      ) : (
        <ul className="space-y-3">
          {agent.skillStatus.map((item: any) => (
            <li key={item.skillId} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-slate-300">{item.name}</span>
              {item.state === "executable" && (
                <span className="text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-2 py-0.5">
                  Ejecutable
                </span>
              )}
              {item.state === "requires_connection" && (
                <button
                  onClick={onGoToIntegrations}
                  className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-0.5 hover:bg-amber-400/20 transition"
                >
                  Conecta {item.provider}
                </button>
              )}
              {item.state === "informational" && (
                <span className="text-xs text-slate-500 bg-slate-500/10 border border-slate-500/20 rounded px-2 py-0.5">
                  Informativa
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
