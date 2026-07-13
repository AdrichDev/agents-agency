"use client";

import { LLM_PROVIDERS, allowedEffortsFor, defaultEffortFor, modelSupportsEffort } from "@/lib/models";

/**
 * Selector reutilizable de modelo LLM + reasoning_effort.
 * Fuente única: lib/models.ts. Los niveles de effort son POR MODELO (allowedEffortsFor):
 * el selector muestra solo los válidos y se deshabilita en modelos no-razonadores.
 * Al cambiar de modelo, el effort se reajusta al default de ese modelo (evita niveles
 * inválidos que la API rechazaría).
 *
 * Usado en: creación de agente, edición de agente, config global y estudios de mercado.
 */
export function ModelEffortSelect({
  model,
  effort,
  onModelChange,
  onEffortChange,
  selectClassName = "input-dark w-full",
  labelClassName = "block text-xs text-slate-400 mb-1.5",
  layout = "row",
}: {
  model: string;
  effort: string;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: string) => void;
  selectClassName?: string;
  labelClassName?: string;
  layout?: "row" | "stacked";
}) {
  const efforts = allowedEffortsFor(model);
  const showEffort = modelSupportsEffort(model);
  const wrapper = layout === "row" ? "grid grid-cols-2 gap-4" : "space-y-4";

  // Cambiar de modelo → reajusta el effort a un valor válido para el nuevo modelo.
  function handleModelChange(nextModel: string) {
    onModelChange(nextModel);
    const allowed = allowedEffortsFor(nextModel).map((e) => e.id);
    if (!allowed.includes(effort)) {
      onEffortChange(defaultEffortFor(nextModel) ?? "");
    }
  }

  return (
    <div className={wrapper}>
      <div>
        <label className={labelClassName}>Modelo de IA</label>
        <select
          className={selectClassName}
          value={model}
          onChange={(e) => handleModelChange(e.target.value)}
        >
          {LLM_PROVIDERS.map((p) => (
            <optgroup key={p.id} label={p.label}>
              {p.models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div>
        <label className={`${labelClassName} ${showEffort ? "" : "opacity-40"}`}>
          Esfuerzo de razonamiento
        </label>
        <select
          className={selectClassName}
          value={showEffort ? effort : ""}
          onChange={(e) => onEffortChange(e.target.value)}
          disabled={!showEffort}
        >
          {efforts.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
          {!showEffort && <option value="">—</option>}
        </select>
        {!showEffort && (
          <p className="text-[11px] text-slate-500 mt-1">Este modelo no usa esfuerzo de razonamiento.</p>
        )}
      </div>
    </div>
  );
}
