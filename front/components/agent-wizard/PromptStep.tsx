import type { AgentWizardForm } from "@/components/agent-wizard/types";
import { LLM_PROVIDERS, allowedEffortsFor, defaultEffortFor, providerOfModel, modelSupportsEffort } from "@/lib/models";

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
  const isOpenclaw = form.runtime === "openclaw";

  // Cambiar de modelo → reajusta el effort a un valor válido para ese modelo.
  function selectModel(nextModel: string) {
    set("model", nextModel);
    const allowed = allowedEffortsFor(nextModel).map((e) => e.id);
    if (!allowed.includes(form.reasoningEffort)) set("reasoningEffort", defaultEffortFor(nextModel) ?? "");
  }

  function onProviderChange(providerId: string) {
    const p = LLM_PROVIDERS.find((x) => x.id === providerId) ?? LLM_PROVIDERS[0];
    // Al cambiar de proveedor, selecciona su primer modelo.
    selectModel(p.models[0].id);
  }

  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-white">Personalidad y comportamiento</h2>
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

      {/* Cerebro del agente (runtime). Antes el wizard mostraba SIEMPRE el
          selector de proveedor/modelo/effort aunque el runtime fuese openclaw
          y esos valores se ignorasen por completo (el gateway decide el modelo).
          Ahora la elección es explícita y solo se configura lo que aplica. */}
      <div className="border-t border-white/5 pt-4 space-y-3">
        <span className="block text-xs text-slate-400">Cerebro del agente</span>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => set("runtime", "openclaw")}
            className={`rounded-xl p-3 text-left border transition ${
              isOpenclaw
                ? "border-[var(--neon-purple)] bg-[var(--neon-purple)]/15"
                : "border-edge hover:border-[var(--neon-purple)]/50 hover:bg-white/5"
            }`}
          >
            <div className="font-medium text-sm text-slate-200">OpenClaw (local)</div>
            <div className="text-xs text-slate-500 mt-1">
              Se ejecuta en el gateway propio de 3A. El modelo lo gobierna la configuración del
              servidor — sin coste por token de terceros.
            </div>
          </button>
          <button
            type="button"
            onClick={() => set("runtime", "openai")}
            className={`rounded-xl p-3 text-left border transition ${
              !isOpenclaw
                ? "border-[var(--neon-purple)] bg-[var(--neon-purple)]/15"
                : "border-edge hover:border-[var(--neon-purple)]/50 hover:bg-white/5"
            }`}
          >
            <div className="font-medium text-sm text-slate-200">Cloud (OpenAI / Gemini)</div>
            <div className="text-xs text-slate-500 mt-1">
              Se ejecuta contra el proveedor cloud que elijas. Aquí sí eliges modelo y nivel de
              razonamiento.
            </div>
          </button>
        </div>

        {isOpenclaw ? (
          <p className="text-xs text-slate-500 rounded-xl border border-edge bg-white/5 p-3">
            🧠 El agente se aprovisiona automáticamente en OpenClaw al crearlo. El modelo
            (primario y fallbacks) se gestiona en la configuración del gateway, no por agente.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                onChange={(e) => selectModel(e.target.value)}
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
                value={showEffort ? form.reasoningEffort : ""}
                onChange={(e) => set("reasoningEffort", e.target.value)}
                disabled={!showEffort}
                title={showEffort ? "" : "Este modelo no usa razonamiento"}
              >
                {allowedEffortsFor(form.model).map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
                {!showEffort && <option value="">—</option>}
              </select>
            </label>
          </div>
        )}
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
