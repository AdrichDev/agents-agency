"use client";

import { useState } from "react";
import { api } from "@/lib/api";

interface ScheduleRow {
  day: number;
  open: string;
  close: string;
}

interface EcommerceConfig {
  businessHours?: {
    timezone: string;
    schedule: ScheduleRow[];
  };
  handoffSlackChannel?: string;
  orderStatusUrl?: string;
  orderStatusApiKey?: string; // "***" si ya configurada
}

interface Props {
  agentId: string;
  initial: EcommerceConfig;
  onChange?: () => void;
}

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const DEFAULT_SCHEDULE: ScheduleRow[] = [
  { day: 1, open: "09:00", close: "18:00" },
  { day: 2, open: "09:00", close: "18:00" },
  { day: 3, open: "09:00", close: "18:00" },
  { day: 4, open: "09:00", close: "18:00" },
  { day: 5, open: "09:00", close: "18:00" },
];

export default function EcommerceConfigPanel({ agentId, initial, onChange }: Props) {
  const [timezone, setTimezone] = useState(initial.businessHours?.timezone ?? "Europe/Madrid");
  const [schedule, setSchedule] = useState<ScheduleRow[]>(
    initial.businessHours?.schedule ?? DEFAULT_SCHEDULE
  );
  const [slackChannel, setSlackChannel] = useState(initial.handoffSlackChannel ?? "");
  const [orderStatusUrl, setOrderStatusUrl] = useState(initial.orderStatusUrl ?? "");
  // Si ya hay apiKey configurada, mostrar placeholder "configurada"
  const [apiKey, setApiKey] = useState("");
  const apiKeyConfigured = initial.orderStatusApiKey === "***";

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const body: any = {
        businessHours: { timezone, schedule },
        handoffSlackChannel: slackChannel,
        orderStatusUrl,
      };
      // Solo enviar apiKey si el usuario la escribió
      if (apiKey.trim()) body.orderStatusApiKey = apiKey;

      await api(`/api/agents/${agentId}/ecommerce-config`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setSaved(true);
      setApiKey(""); // limpiar campo después de guardar
      onChange?.();
    } catch (e: any) {
      setError(e?.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  function updateScheduleRow(index: number, field: keyof ScheduleRow, value: string | number) {
    setSchedule((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  function addDay() {
    const usedDays = new Set(schedule.map((r) => r.day));
    const next = [1, 2, 3, 4, 5, 6, 0].find((d) => !usedDays.has(d));
    if (next !== undefined) {
      setSchedule((prev) => [...prev, { day: next, open: "09:00", close: "18:00" }]);
    }
  }

  function removeDay(index: number) {
    setSchedule((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="card p-6 space-y-6">
      <h3 className="font-semibold text-sm text-white">Configuración de comercio y handoff</h3>

      {/* Horario comercial */}
      <section className="space-y-3">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Horario comercial</h4>
        <div className="flex gap-2 items-center">
          <label className="text-xs text-slate-400 w-20 shrink-0">Zona horaria</label>
          <input
            className="input-dark flex-1 text-xs"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Europe/Madrid"
          />
        </div>
        <div className="space-y-2">
          {schedule.map((row, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select
                className="input-dark text-xs w-28"
                value={row.day}
                onChange={(e) => updateScheduleRow(i, "day", Number(e.target.value))}
              >
                {DAY_NAMES.map((name, d) => (
                  <option key={d} value={d}>
                    {name}
                  </option>
                ))}
              </select>
              <input
                className="input-dark text-xs w-20"
                type="time"
                value={row.open}
                onChange={(e) => updateScheduleRow(i, "open", e.target.value)}
              />
              <span className="text-slate-500 text-xs">—</span>
              <input
                className="input-dark text-xs w-20"
                type="time"
                value={row.close}
                onChange={(e) => updateScheduleRow(i, "close", e.target.value)}
              />
              <button
                onClick={() => removeDay(i)}
                className="text-xs text-red-400 hover:text-red-300 ml-1"
              >
                Quitar
              </button>
            </div>
          ))}
          <button onClick={addDay} className="text-xs text-indigo-400 hover:text-indigo-300">
            + Añadir día
          </button>
        </div>
        <p className="text-xs text-slate-600">
          Sin horario configurado o timezone inválida → disponible 24/7.
        </p>
      </section>

      {/* Canal Slack de handoff */}
      <section className="space-y-2">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Canal Slack para handoff</h4>
        <input
          className="input-dark w-full text-xs"
          placeholder="#soporte"
          value={slackChannel}
          onChange={(e) => setSlackChannel(e.target.value)}
        />
        <p className="text-xs text-slate-600">
          Si Slack está conectado y se configura este canal, se enviará un resumen al escalar a humano.
        </p>
      </section>

      {/* Endpoint de pedidos */}
      <section className="space-y-2">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Estado de pedidos</h4>
        <div>
          <label className="text-xs text-slate-400 block mb-1">URL del endpoint</label>
          <input
            className="input-dark w-full text-xs"
            placeholder="https://api.tutienda.com/orders"
            value={orderStatusUrl}
            onChange={(e) => setOrderStatusUrl(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">
            API Key{" "}
            {apiKeyConfigured && !apiKey && (
              <span className="text-emerald-400">(configurada — dejar vacío para conservar)</span>
            )}
          </label>
          <input
            className="input-dark w-full text-xs"
            type="password"
            placeholder={apiKeyConfigured ? "••••••••" : "Token de autenticación"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
      </section>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={save}
          disabled={saving}
          className="btn-grad text-xs px-4 py-1.5 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar config"}
        </button>
        {saved && <span className="text-xs text-emerald-400">Guardado</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
