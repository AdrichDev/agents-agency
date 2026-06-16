"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { LLM_PROVIDERS, REASONING_EFFORTS, providerOfModel, modelSupportsEffort } from "@/lib/models";

/** Editor de modelo LLM + reasoning_effort de un agente existente. PATCH /api/agents/:id. */
export default function AgentModelPanel({ agent, onChange }: { agent: any; onChange: () => void }) {
  const [model, setModel] = useState<string>(agent.model ?? "gpt-5.4-mini");
  const [effort, setEffort] = useState<string>(agent.reasoningEffort ?? "low");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const provider = providerOfModel(model);
  const showEffort = modelSupportsEffort(model);
  const dirty = model !== (agent.model ?? "gpt-5.4-mini") || effort !== (agent.reasoningEffort ?? "low");

  function onProviderChange(providerId: string) {
    const p = LLM_PROVIDERS.find((x) => x.id === providerId) ?? LLM_PROVIDERS[0];
    setModel(p.models[0].id);
  }

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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block text-xs text-slate-400">
          Proveedor
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
            value={model}
            onChange={(e) => setModel(e.target.value)}
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
            value={effort}
            onChange={(e) => setEffort(e.target.value)}
            disabled={!showEffort}
            title={showEffort ? "" : "Solo modelos GPT-5*"}
          >
            {REASONING_EFFORTS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button className="btn-grad text-sm" onClick={save} disabled={saving || !dirty}>
          {saving ? "Guardando..." : "Guardar"}
        </button>
        {status && <span className="text-xs text-emerald-400">{status}</span>}
      </div>
    </div>
  );
}
