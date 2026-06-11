"use client";

import { useState } from "react";
import { api } from "@/lib/api";

interface Automation {
  id: string;
  name: string;
  trigger: string;
  prompt: string;
  enabled: boolean;
  lastRunAt?: string | null;
}

const TRIGGERS = [
  ["new_email", "📧 Email nuevo"],
  ["new_slack_message", "💬 Mensaje de Slack"],
  ["schedule", "⏰ Cada 5 minutos"],
];

const EXAMPLES = [
  "Clasifica cada email con una etiqueta (Urgente/Cliente/Spam). Para los urgentes crea un ticket en Jira proyecto SUP con prioridad High y avisa en #soporte de Slack.",
  "Si el email es una factura, archívalo con la etiqueta Facturas.",
  "Resume los mensajes de #ventas y crea eventos de calendario para las reuniones que se mencionen.",
];

export default function AutomationsPanel({
  agentId,
  automations,
  onChange,
}: {
  agentId: string;
  automations: Automation[];
  onChange: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", trigger: "new_email", prompt: "" });
  const [saving, setSaving] = useState(false);

  async function create() {
    setSaving(true);
    await api("/api/automations", { method: "POST", body: JSON.stringify({ agentId, ...form }) });
    setSaving(false);
    setShowForm(false);
    setForm({ name: "", trigger: "new_email", prompt: "" });
    onChange();
  }

  async function toggle(a: Automation) {
    await api("/api/automations", { method: "PATCH", body: JSON.stringify({ id: a.id, enabled: !a.enabled }) });
    onChange();
  }

  async function remove(id: string) {
    await api("/api/automations", { method: "DELETE", body: JSON.stringify({ id }) });
    onChange();
  }

  return (
    <div className="space-y-4">
      {automations.map((a) => (
        <div key={a.id} className="card p-4 flex items-start gap-3">
          <button
            onClick={() => toggle(a)}
            className={`mt-0.5 w-9 h-5 rounded-full relative transition ${
              a.enabled ? "bg-gradient-to-r from-indigo-500 to-fuchsia-500" : "bg-white/10"
            }`}
            title={a.enabled ? "Desactivar" : "Activar"}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${a.enabled ? "left-[18px]" : "left-0.5"}`} />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-white">{a.name}</h3>
              <span className="chip">{TRIGGERS.find(([t]) => t === a.trigger)?.[1] ?? a.trigger}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">{a.prompt}</p>
            {a.lastRunAt && (
              <p className="text-xs text-slate-600 mt-1">
                Última ejecución: {new Date(a.lastRunAt).toLocaleString("es-ES")}
              </p>
            )}
          </div>
          <button onClick={() => remove(a.id)} className="text-slate-700 hover:text-red-400 text-sm">✕</button>
        </div>
      ))}

      {showForm ? (
        <div className="card border-indigo-500/40 p-5 space-y-3">
          <input
            className="input-dark"
            placeholder="Nombre (p.ej. Emails urgentes → Jira)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div className="flex gap-2">
            {TRIGGERS.map(([value, label]) => (
              <button
                key={value}
                onClick={() => setForm({ ...form, trigger: value })}
                className={`text-xs px-3 py-2 rounded-xl border transition ${
                  form.trigger === value
                    ? "border-indigo-500 bg-indigo-500/15 text-indigo-200"
                    : "border-edge bg-white/5 text-slate-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            className="input-dark h-24"
            placeholder="¿Qué debe hacer el agente? En lenguaje natural."
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
          />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => setForm({ ...form, prompt: ex })}
                className="chip hover:border-indigo-500/40 hover:text-indigo-300 transition"
              >
                Ejemplo {i + 1}
              </button>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="text-sm text-slate-500 px-3 py-2">
              Cancelar
            </button>
            <button onClick={create} disabled={saving || !form.name || !form.prompt} className="btn-grad">
              {saving ? "Guardando…" : "Crear automatización"}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-white/10 rounded-2xl py-5 text-sm text-slate-500 hover:border-indigo-500/40 hover:text-indigo-300 transition"
        >
          + Nueva automatización — descríbela en lenguaje natural, sin código
        </button>
      )}
    </div>
  );
}
