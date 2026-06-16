"use client";

import { LLM_PROVIDERS, REASONING_EFFORTS, modelSupportsEffort } from "@/lib/models";

/**
 * Selector reutilizable de modelo LLM + reasoning_effort.
 * Fuente única: lib/models.ts (LLM_PROVIDERS / REASONING_EFFORTS).
 * El selector de effort se deshabilita automáticamente para modelos no-razonadores.
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
  const showEffort = modelSupportsEffort(model);
  const wrapper = layout === "row" ? "grid grid-cols-2 gap-4" : "space-y-4";

  return (
    <div className={wrapper}>
      <div>
        <label className={labelClassName}>Modelo de IA</label>
        <select
          className={selectClassName}
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
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
          value={effort}
          onChange={(e) => onEffortChange(e.target.value)}
          disabled={!showEffort}
        >
          {REASONING_EFFORTS.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
        {!showEffort && (
          <p className="text-[11px] text-slate-500 mt-1">Solo aplica a modelos GPT-5*.</p>
        )}
      </div>
    </div>
  );
}
