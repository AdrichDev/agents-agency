"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { ModelEffortSelect } from "@/components/ModelEffortSelect";

/** Editor de modelo LLM + reasoning_effort de un agente existente. PATCH /api/agents/:id. */
export default function AgentModelPanel({ agent, onChange }: { agent: any; onChange: () => void }) {
  const [model, setModel] = useState<string>(agent.model ?? "gpt-5.4-mini");
  const [effort, setEffort] = useState<string>(agent.reasoningEffort ?? "low");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const dirty = model !== (agent.model ?? "gpt-5.4-mini") || effort !== (agent.reasoningEffort ?? "low");

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      await api(`/api/agents/${agent.id}`, {
        method: "PATCH",
        body: JSON.stringify({ model, reasoningEffort: effort }),
      });
      setStatus("✓ Guardado");
      onChange();
      setTimeout(() => setStatus(""), 2500);
    } catch {
      setStatus("Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-6 space-y-4 max-w-xl">
      <div>
        <h3 className="font-semibold text-sm text-white">Modelo de IA</h3>
        <p className="text-xs text-slate-500 mt-1">
          Cambia el LLM y el nivel de razonamiento de este agente. El razonamiento (effort) afecta el coste — solo aplica a modelos GPT-5*.
        </p>
      </div>

      <ModelEffortSelect
        model={model}
        effort={effort}
        onModelChange={setModel}
        onEffortChange={setEffort}
        selectClassName="input-dark text-sm w-full mt-1"
      />

      <div className="flex items-center gap-3 pt-1">
        <button className="btn-grad text-sm" onClick={save} disabled={saving || !dirty}>
          {saving ? "Guardando..." : "Guardar"}
        </button>
        {status && <span className="text-xs text-emerald-400">{status}</span>}
      </div>
    </div>
  );
}
