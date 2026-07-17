"use client";

import {
  TRIGGERS,
  INTERVALS,
  SERVICES,
  EXAMPLES,
  type AutomationFormState,
} from "./automationCatalog";
import type { ServiceConnectionState } from "@/hooks/useAutomations";

/**
 * Formulario de creación de automatizaciones. Extraído del panel sin cambios de
 * UI. La lógica de conexión (canSave, estado del servicio) se calcula aquí a
 * partir de `getServiceConnectionState`, igual que en el inline previo.
 */
export default function AutomationForm({
  agentId,
  form,
  setForm,
  saving,
  n8nConfigured,
  serviceToProvider,
  getServiceConnectionState,
  onCreate,
  onCancel,
}: {
  agentId: string;
  form: AutomationFormState;
  setForm: (form: AutomationFormState) => void;
  saving: boolean;
  n8nConfigured: boolean;
  serviceToProvider: Record<string, string>;
  getServiceConnectionState: (serviceId: string) => ServiceConnectionState;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const selectedService = SERVICES.find((s) => s.id === form.service);

  const selectedServiceConnectionState = form.service
    ? getServiceConnectionState(form.service)
    : null;
  const canSave =
    selectedServiceConnectionState === null ||
    selectedServiceConnectionState === "connected";

  return (
    <div className="card border-indigo-500/40 p-5 space-y-3">
      <input
        className="input-dark"
        placeholder="Nombre (p.ej. Emails urgentes → Jira)"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />

      <div>
        <p className="text-xs text-slate-500 mb-1.5">¿Cuándo se ejecuta? (trigger)</p>
        <div className="flex gap-2 flex-wrap">
          {TRIGGERS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setForm({ ...form, trigger: value })}
              className={`text-xs px-3 py-2 rounded-xl border transition ${
                form.trigger === value
                  ? "border-[var(--neon-purple)] bg-[var(--neon-purple)]/15 text-[var(--neon-pink)]"
                  : "border-edge hover:border-[var(--neon-purple)]/50 hover:bg-white/5 text-slate-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {form.trigger === "schedule" && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5">Frecuencia del job</p>
          <select
            className="input-dark"
            value={form.intervalMinutes}
            onChange={(e) => setForm({ ...form, intervalMinutes: Number(e.target.value) })}
          >
            {INTERVALS.map(([minutes, label]) => (
              <option key={minutes} value={minutes}>{label}</option>
            ))}
          </select>
          {!n8nConfigured && (
            <p className="text-[11px] text-slate-600 mt-1.5">
              Con el motor interno la revisión es ~cada 5 min; el intervalo exacto solo aplica con
              n8n encendido.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-500 mb-1.5">Herramienta principal</p>
          <select
            className="input-dark"
            value={form.service}
            onChange={(e) => setForm({ ...form, service: e.target.value, action: "" })}
          >
            <option value="">Sin herramienta específica</option>
            {SERVICES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        {selectedService && (
          <div>
            <p className="text-xs text-slate-500 mb-1.5">Acción</p>
            <select
              className="input-dark"
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value })}
            >
              <option value="">Elige una acción…</option>
              {selectedService.actions.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>
        )}
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
      <p className="text-[11px] text-slate-600">
        {n8nConfigured
          ? "La automatización se sincronizará con n8n: los triggers programados se convierten en jobs y los de evento (email, Slack) en webhooks."
          : "La automatización la ejecuta el motor interno por sondeo (~cada 5 min, no es instantáneo) y requiere el proveedor conectado (email/Slack) en Integraciones."}
      </p>
      {/* Aviso de conexión OAuth requerida (R6-2) */}
      {form.service && selectedServiceConnectionState === "disconnected" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          Este servicio requiere conectar{" "}
          <strong>{serviceToProvider[form.service] ?? form.service}</strong> en la pestaña{" "}
          <a
            href={`/agents/${agentId}?tab=integraciones`}
            className="underline hover:text-amber-200"
          >
            Integraciones
          </a>
          .
        </div>
      )}
      {form.service && selectedServiceConnectionState === "reauth_required" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          La conexión con{" "}
          <strong>{serviceToProvider[form.service] ?? form.service}</strong> requiere
          reconexión.{" "}
          <a
            href={`/agents/${agentId}?tab=integraciones`}
            className="underline hover:text-amber-200"
          >
            Ir a Integraciones
          </a>
        </div>
      )}
      {form.service && selectedServiceConnectionState === "upcoming" && (
        <div className="rounded-xl border border-slate-700 bg-white/5 px-4 py-3 text-xs text-slate-400">
          Este servicio estará disponible próximamente.
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-sm text-slate-500 px-3 py-2">
          Cancelar
        </button>
        <button
          onClick={onCreate}
          disabled={saving || !form.name || !form.prompt || !canSave}
          className="btn-grad"
          title={!canSave ? "Conecta el servicio requerido antes de guardar" : undefined}
        >
          {saving ? "Guardando…" : "Crear automatización"}
        </button>
      </div>
    </div>
  );
}
