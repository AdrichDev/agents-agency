import type { AgentWizardForm } from "@/components/agent-wizard/types";
import { LLM_PROVIDERS, REASONING_EFFORTS, providerOfModel, modelSupportsEffort } from "@/lib/models";

export default function PromptStep({
  form,
  set,
  improving,
  onImprove,
}: {
  form: AgentWizardForm;
  set: <K extends keyof AgentWizardForm>(key: K, value: AgentWizardForm[K]) => void;
  improving: boolean;
  onImprove: () => void;
}) {
  const provider = providerOfModel(form.model);
  const showEffort = modelSupportsEffort(form.model);

  function onProviderChange(providerId: string) {
    const p = LLM_PROVIDERS.find((x) => x.id === providerId) ?? LLM_PROVIDERS[0];
    // Al cambiar de proveedor, selecciona su primer modelo.
    set("model", p.models[0].id);
  }

  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-white">Paso 3 - Personalidad y comportamiento</h2>
      <input
        className="input-dark"
        placeholder="Nombre del agente (p.ej. DorsIA)"
        value={form.name}
        onChange={(e) => set("name", e.target.value)}
      />
      <div className="relative">
        <textarea
          className="input-dark h-48"
          value={form.systemPrompt}
          onChange={(e) => set("systemPrompt", e.target.value)}
        />
        {improving && (
          <div className="absolute inset-0 grid place-items-center bg-black/40 rounded-xl text-sm text-indigo-300">
            Generando personalidad para {form.sector || "tu agente"}...
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onImprove}
        disabled={improving}
        className="btn-dark !text-xs border-[var(--neon-purple)]/40 text-[var(--neon-pink)] hover:bg-[var(--neon-purple)]/10"
      >
        {improving ? "Mejorando..." : "Mejorar prompt con IA"}
      </button>
      {/* Selección de LLM, modelo y effort */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-white/5 pt-4">
        <label className="block text-xs text-slate-400">
          Proveedor LLM
          <select
            className="input-dark text-sm w-full mt-1"
            value={provider.id}
            onChange={(e) => onProviderChange(e.target.value)}
          >
            {LLM_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-400">
          Modelo
          <select
            className="input-dark text-sm w-full mt-1"
            value={form.model}
            onChange={(e) => set("model", e.target.value)}
          >
            {provider.models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>
        <label className={`block text-xs text-slate-400 ${showEffort ? "" : "opacity-40"}`}>
          Razonamiento (coste)
          <select
            className="input-dark text-sm w-full mt-1"
            value={form.reasoningEffort}
            onChange={(e) => set("reasoningEffort", e.target.value)}
            disabled={!showEffort}
            title={showEffort ? "" : "Solo modelos GPT-5*"}
          >
            {REASONING_EFFORTS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-sm text-slate-400">
        Creatividad: <span className="text-indigo-300">{form.temperature}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={form.temperature}
          onChange={(e) => set("temperature", Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
      </label>
    </div>
  );
}

