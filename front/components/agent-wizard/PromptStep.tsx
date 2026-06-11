import type { AgentWizardForm } from "@/components/agent-wizard/types";

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

