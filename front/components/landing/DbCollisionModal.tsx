"use client";

/**
 * Modal de confirmación cuando un cambio de capa de datos colisiona con archivos
 * existentes. Extraído de la página del builder sin cambios de UI.
 */
export function DbCollisionModal({
  collision,
  busy,
  onConfirm,
  onCancel,
}: {
  collision: { collisions: string[]; diff: string };
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="card p-6 w-full max-w-lg">
        <h3 className="text-white font-semibold mb-2">⚠️ Conflicto detectado</h3>
        <p className="text-slate-400 text-sm mb-3">
          Los siguientes archivos serán modificados por la nueva capa de datos:
        </p>
        <ul className="mb-3">
          {collision.collisions.map((f) => (
            <li key={f} className="text-amber-400 text-xs font-mono mb-1">• {f}</li>
          ))}
        </ul>
        <pre className="bg-black/30 rounded-xl p-3 text-xs text-slate-300 overflow-auto max-h-40 mb-4 font-mono">
          {collision.diff}
        </pre>
        <div className="flex gap-3">
          <button
            className="btn-grad flex-1"
            onClick={onConfirm}
            disabled={busy}
          >
            Confirmar y sobrescribir
          </button>
          <button
            className="btn-dark"
            onClick={onCancel}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
