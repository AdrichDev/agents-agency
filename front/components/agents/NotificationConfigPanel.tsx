"use client";

import { useState } from "react";
import { api } from "@/lib/api";

const EVENTS = [
  { id: "nueva_reserva", label: "Nueva reserva" },
  { id: "nuevo_lead", label: "Nuevo lead" },
  { id: "handoff", label: "Escalado a humano" },
] as const;

/**
 * Config de notificaciones al DUEÑO del negocio (F5, design.md §D): a qué chat
 * de Telegram avisar y con qué eventos. Se persiste en
 * AgentDataBackend.notificationConfig — el dispatcher real de envíos es F6;
 * aquí SOLO la configuración.
 */
export default function NotificationConfigPanel({ agent, onChange }: { agent: any; onChange: () => void }) {
  const cfg = (agent.dataBackend?.notificationConfig ?? {}) as {
    telegramChatId?: string;
    events?: string[];
  };
  const [chatId, setChatId] = useState(cfg.telegramChatId ?? "");
  const [events, setEvents] = useState<string[]>(cfg.events ?? []);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const dirty =
    chatId !== (cfg.telegramChatId ?? "") ||
    JSON.stringify([...events].sort()) !== JSON.stringify([...(cfg.events ?? [])].sort());

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      await api(`/api/agents/${agent.id}/backend`, {
        method: "PATCH",
        body: JSON.stringify({ notificationConfig: { telegramChatId: chatId, events } }),
      });
      setStatus("✓ Guardado");
      onChange();
      setTimeout(() => setStatus(""), 2500);
    } catch (e: any) {
      setStatus(e?.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  if (!agent.dataBackend) return null;

  return (
    <div className="card p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-sm text-white">Notificaciones al dueño del negocio</h3>
        <p className="text-xs text-slate-500 mt-1">
          Destino de los avisos (reservas, leads, escalados). El envío automático se activa en una
          fase posterior; aquí se configura a dónde y con qué eventos.
        </p>
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1">Chat ID de Telegram del dueño</label>
        <input
          className="input-dark w-full text-xs"
          placeholder="p.ej. 123456789"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs text-slate-400 block">Eventos</label>
        <div className="flex gap-4 flex-wrap">
          {EVENTS.map((ev) => (
            <label key={ev.id} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={events.includes(ev.id)}
                onChange={(e) =>
                  setEvents((prev) =>
                    e.target.checked ? [...prev, ev.id] : prev.filter((x) => x !== ev.id)
                  )
                }
              />
              {ev.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button className="btn-grad text-xs px-4 py-1.5 disabled:opacity-50" onClick={save} disabled={saving || !dirty}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {status && <span className="text-xs text-emerald-400">{status}</span>}
      </div>
    </div>
  );
}
