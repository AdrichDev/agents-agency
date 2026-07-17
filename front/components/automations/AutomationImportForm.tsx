"use client";

import { useState } from "react";
import { api } from "@/lib/api";

/**
 * Import de un workflow n8n como automatización del agente (F5, AC8) — camino
 * principal: pegar el JSON exportado o adoptar uno de NUESTRA instancia por ID.
 * Scoping estricto por agente en el back (tag [agent:<id>] + vínculo único).
 */
export default function AutomationImportForm({
  agentId,
  n8nConfigured,
  onImported,
  onCancel,
}: {
  agentId: string;
  n8nConfigured: boolean;
  onImported: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"json" | "instance">("json");
  const [name, setName] = useState("");
  const [json, setJson] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = { agentId };
      if (name.trim()) body.name = name.trim();
      if (mode === "json") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch {
          setError("El JSON pegado no es válido.");
          return;
        }
        body.workflowJson = parsed;
      } else {
        body.n8nWorkflowId = workflowId.trim();
      }
      await api("/api/automations/import", { method: "POST", body: JSON.stringify(body) });
      onImported();
    } catch (e: any) {
      setError(e?.message ?? "Error al importar el workflow");
    } finally {
      setSaving(false);
    }
  }

  // Con n8n apagado, los workflows importados no se pueden ejecutar: se bloquea el submit
  // (paridad con el back, que responde 503) en vez de crear una fila inerte.
  const hasInput = mode === "json" ? json.trim().length > 0 : workflowId.trim().length > 0;
  const canSubmit = hasInput && n8nConfigured;

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm text-white">Importar workflow n8n</h3>
        <p className="text-xs text-slate-500 mt-1">
          El workflow corre en nuestra instancia n8n, scopeado a este agente.
        </p>
      </div>

      {!n8nConfigured && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          El motor n8n está apagado; los workflows importados requieren n8n. Las automatizaciones
          en lenguaje natural (email, Slack, programadas) sí funcionan con el motor interno.
        </div>
      )}

      <div className="flex gap-2">
        <button
          className={`text-xs px-3 py-1.5 rounded-lg border transition ${
            mode === "json" ? "border-indigo-500 text-white" : "border-edge text-slate-400"
          }`}
          onClick={() => setMode("json")}
        >
          Pegar JSON
        </button>
        <button
          className={`text-xs px-3 py-1.5 rounded-lg border transition ${
            mode === "instance" ? "border-indigo-500 text-white" : "border-edge text-slate-400"
          }`}
          onClick={() => setMode("instance")}
        >
          Por ID de la instancia
        </button>
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1">Nombre (opcional)</label>
        <input
          className="input-dark w-full text-xs"
          placeholder="p.ej. Aviso diario de reservas"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {mode === "json" ? (
        <div>
          <label className="text-xs text-slate-400 block mb-1">JSON del workflow (export de n8n)</label>
          <textarea
            className="input-dark w-full text-xs font-mono min-h-40"
            placeholder='{"name": "...", "nodes": [...], "connections": {...}}'
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
        </div>
      ) : (
        <div>
          <label className="text-xs text-slate-400 block mb-1">ID del workflow en n8n</label>
          <input
            className="input-dark w-full text-xs"
            placeholder="p.ej. pKq2vNe31Xb8"
            value={workflowId}
            onChange={(e) => setWorkflowId(e.target.value)}
          />
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button className="btn-grad text-xs px-4 py-1.5 disabled:opacity-50" onClick={submit} disabled={saving || !canSubmit}>
          {saving ? "Importando…" : "Importar"}
        </button>
        <button className="btn-dark text-xs px-4 py-1.5" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
