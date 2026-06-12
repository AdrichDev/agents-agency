"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface AutomationConfig {
  service?: string;
  action?: string;
  intervalMinutes?: number;
}

interface Automation {
  id: string;
  name: string;
  trigger: string;
  prompt: string;
  config?: AutomationConfig;
  enabled: boolean;
  lastRunAt?: string | null;
  // R6-6: campos de sincronización n8n
  n8nWorkflowId?: string | null;
  syncStatus?: "synced" | "pending" | "error";
}

const TRIGGERS = [
  ["new_email", "📧 Email nuevo"],
  ["new_slack_message", "💬 Mensaje de Slack"],
  ["schedule", "⏰ Programado (job)"],
];

const INTERVALS: [number, string][] = [
  [5, "Cada 5 minutos"],
  [15, "Cada 15 minutos"],
  [60, "Cada hora"],
  [1440, "Cada día"],
];

// Catálogo extensible de servicios y acciones. Base para generar
// los workflows de n8n (jobs programados o webhooks por evento).
const SERVICES: { id: string; label: string; actions: [string, string][] }[] = [
  {
    id: "google_calendar",
    label: "📅 Google Calendar",
    actions: [
      ["create_event", "Crear evento"],
      ["list_events", "Listar eventos"],
      ["update_event", "Actualizar evento"],
      ["delete_event", "Eliminar evento"],
    ],
  },
  {
    id: "gmail",
    label: "📧 Gmail",
    actions: [
      ["send_email", "Enviar email"],
      ["label_email", "Etiquetar email"],
      ["draft_reply", "Crear borrador de respuesta"],
    ],
  },
  {
    id: "slack",
    label: "💬 Slack",
    actions: [
      ["post_message", "Publicar mensaje"],
      ["create_channel", "Crear canal"],
      ["summarize_channel", "Resumir canal"],
    ],
  },
  {
    id: "notion",
    label: "📝 Notion",
    actions: [
      ["create_page", "Crear página"],
      ["append_block", "Añadir contenido"],
      ["query_database", "Consultar base de datos"],
    ],
  },
  {
    id: "jira",
    label: "🎫 Jira",
    actions: [
      ["create_ticket", "Crear ticket"],
      ["transition_ticket", "Mover ticket"],
      ["comment_ticket", "Comentar ticket"],
    ],
  },
  {
    id: "instagram",
    label: "📸 Instagram",
    actions: [
      ["publish_post", "Publicar post"],
      ["schedule_post", "Programar post"],
    ],
  },
];

const EXAMPLES = [
  "Clasifica cada email con una etiqueta (Urgente/Cliente/Spam). Para los urgentes crea un ticket en Jira proyecto SUP con prioridad High y avisa en #soporte de Slack.",
  "Si el email es una factura, archívalo con la etiqueta Facturas.",
  "Resume los mensajes de #ventas y crea eventos de calendario para las reuniones que se mencionen.",
];

const EMPTY_FORM = {
  name: "",
  trigger: "new_email",
  prompt: "",
  service: "",
  action: "",
  intervalMinutes: 5,
};

function describeConfig(config?: AutomationConfig) {
  if (!config?.service) return null;
  const service = SERVICES.find((s) => s.id === config.service);
  if (!service) return null;
  const action = service.actions.find(([id]) => id === config.action);
  return action ? `${service.label} → ${action[1]}` : service.label;
}

interface IntegrationStatus {
  provider: string;
  status: "connected" | "reauth_required" | "disconnected";
}

export default function AutomationsPanel({
  agentId,
  automations,
  onChange,
  n8nConfigured = false,
}: {
  agentId: string;
  automations: Automation[];
  onChange: () => void;
  /** R6-4: si el backend tiene N8N_BASE_URL configurado */
  n8nConfigured?: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  // Mapeo service → provider cargado desde el backend (fuente única R6-1)
  const [serviceToProvider, setServiceToProvider] = useState<Record<string, string>>({});
  const [upcomingProviders, setUpcomingProviders] = useState<string[]>([]);

  const selectedService = SERVICES.find((s) => s.id === form.service);

  // Cargar service-map y estado de integraciones (R6-1, R6-2)
  useEffect(() => {
    api<{ serviceToProvider: Record<string, string>; upcomingProviders: string[] }>(
      `/api/integrations/services`
    )
      .then((d) => {
        setServiceToProvider(d.serviceToProvider ?? {});
        setUpcomingProviders(d.upcomingProviders ?? []);
      })
      .catch(() => {});

    api<{ integrations: IntegrationStatus[] }>(`/api/integrations/${agentId}/status`)
      .then((d) => setIntegrations(d.integrations ?? []))
      .catch(() => {});
  }, [agentId]);

  /** Devuelve el estado de la conexión para el servicio seleccionado, o null si no requiere OAuth */
  function getServiceConnectionState(serviceId: string): "connected" | "reauth_required" | "disconnected" | "upcoming" | null {
    const provider = serviceToProvider[serviceId];
    if (!provider) return null;
    if (upcomingProviders.includes(provider)) return "upcoming";
    const int = integrations.find((i) => i.provider === provider);
    return int?.status ?? "disconnected";
  }

  const selectedServiceConnectionState = form.service
    ? getServiceConnectionState(form.service)
    : null;
  const canSave =
    selectedServiceConnectionState === null ||
    selectedServiceConnectionState === "connected";

  async function create() {
    setSaving(true);
    const config: AutomationConfig = {};
    if (form.service) config.service = form.service;
    if (form.action) config.action = form.action;
    if (form.trigger === "schedule") config.intervalMinutes = form.intervalMinutes;
    await api("/api/automations", {
      method: "POST",
      body: JSON.stringify({
        agentId,
        name: form.name,
        trigger: form.trigger,
        prompt: form.prompt,
        config,
      }),
    });
    setSaving(false);
    setShowForm(false);
    setForm(EMPTY_FORM);
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

  async function resync(id: string) {
    await api(`/api/automations/${id}/resync`, { method: "POST" });
    onChange();
  }

  return (
    <div className="space-y-4">
      {/* R6-4: aviso si n8n no está configurado */}
      {!n8nConfigured && (
        <div className="rounded-xl border border-slate-700 bg-white/5 px-4 py-3 text-xs text-slate-400">
          n8n no configurado — las automatizaciones usan el motor interno
        </div>
      )}

      {automations.map((a) => (
        <div key={a.id} className="card p-4 flex items-start gap-3">
          <button
            onClick={() => toggle(a)}
            className={`mt-0.5 w-9 h-5 rounded-full relative transition ${
              a.enabled ? "bg-neon-gradient" : "bg-white/10"
            }`}
            title={a.enabled ? "Desactivar" : "Activar"}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${a.enabled ? "left-[18px]" : "left-0.5"}`} />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm text-white">{a.name}</h3>
              <span className="chip">{TRIGGERS.find(([t]) => t === a.trigger)?.[1] ?? a.trigger}</span>
              {describeConfig(a.config) && <span className="chip">{describeConfig(a.config)}</span>}
              {a.trigger === "schedule" && a.config?.intervalMinutes && (
                <span className="chip">
                  {INTERVALS.find(([m]) => m === a.config?.intervalMinutes)?.[1] ?? `Cada ${a.config.intervalMinutes} min`}
                </span>
              )}
              {/* R6-1: badge de modo de ejecución */}
              {a.n8nWorkflowId && a.syncStatus === "synced" ? (
                <span className="chip">⚙️ n8n</span>
              ) : (
                <span className="chip">🕐 interno</span>
              )}
              {/* R6-2: badge de error de sync */}
              {a.syncStatus === "error" && (
                <span className="chip text-amber-300">⚠ Error sync</span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">{a.prompt}</p>
            {a.lastRunAt && (
              <p className="text-xs text-slate-600 mt-1">
                Última ejecución: {new Date(a.lastRunAt).toLocaleString("es-ES")}
              </p>
            )}
            {/* R6-3: botón reintentar sync si error */}
            {a.syncStatus === "error" && (
              <button
                onClick={() => resync(a.id)}
                className="text-xs text-amber-400 hover:text-amber-300 mt-1 underline"
              >
                Reintentar sync
              </button>
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
              : "La automatización usará el motor interno. Configura n8n para delegar la ejecución de triggers programados."}
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
            <button onClick={() => setShowForm(false)} className="text-sm text-slate-500 px-3 py-2">
              Cancelar
            </button>
            <button
              onClick={create}
              disabled={saving || !form.name || !form.prompt || !canSave}
              className="btn-grad"
              title={!canSave ? "Conecta el servicio requerido antes de guardar" : undefined}
            >
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
