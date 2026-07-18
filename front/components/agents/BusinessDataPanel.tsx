"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import EcommerceConfigPanel from "@/components/EcommerceConfigPanel";

const MODE_LABEL: Record<string, string> = {
  managed_db: "Base de datos gestionada",
  external_api: "API externa",
  none_yet: "Solo información",
};

const ALL_CAPABILITIES = [
  { id: "reservas", label: "Reservas" },
  { id: "leads", label: "Leads" },
  { id: "pedidos", label: "Pedidos" },
] as const;

interface DataBackend {
  mode: string;
  capabilities: string[];
  notificationConfig: Record<string, unknown>;
  provisioned: boolean;
  // Campos de la vista segura para external_api (pueden no venir aún: lectura defensiva).
  // La apiKey NUNCA se expone; solo el flag apiKeySet indica si hay una guardada.
  apiBaseUrl?: string | null;
  apiKeySet?: boolean;
  businessId?: string | null;
  locationId?: string | null;
}

// external_api solo opera reservas/leads (el adapter no soporta pedidos vía API externa).
const EXTERNAL_API_CAPABILITIES = ALL_CAPABILITIES.filter((c) => c.id !== "pedidos");

/**
 * Tab "Datos del negocio" (F5, design.md §C.2): muestra y gestiona el
 * AgentDataBackend del agente — modo, estado de aprovisionamiento (managed_db
 * nace con dbUrl null; se aprovisiona AQUÍ), capabilities y la config de
 * comercio/handoff migrada desde la antigua tab Integraciones.
 */
export default function BusinessDataPanel({ agent, onChange }: { agent: any; onChange: () => void }) {
  const backend: DataBackend | null = agent.dataBackend ?? null;
  const [caps, setCaps] = useState<string[]>(backend?.capabilities ?? []);
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [status, setStatus] = useState("");

  // Estado del formulario external_api (lectura defensiva de la vista segura).
  const [showExternalForm, setShowExternalForm] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(backend?.apiBaseUrl ?? "");
  const [apiKey, setApiKey] = useState<string>(""); // write-only: nunca se prellena
  const [businessId, setBusinessId] = useState<string>(backend?.businessId ?? "");
  const [locationId, setLocationId] = useState<string>(backend?.locationId ?? "");

  const capsDirty =
    JSON.stringify([...caps].sort()) !== JSON.stringify([...(backend?.capabilities ?? [])].sort());

  async function saveCapabilities() {
    setSaving(true);
    setStatus("");
    try {
      await api(`/api/agents/${agent.id}/backend`, {
        method: "PATCH",
        body: JSON.stringify({ capabilities: caps }),
      });
      setStatus("✓ Capacidades guardadas");
      onChange();
    } catch (e: any) {
      setStatus(e?.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function provision() {
    setProvisioning(true);
    setStatus("");
    try {
      const r = await api<{ status: string; error?: string }>(
        `/api/agents/${agent.id}/backend/provision`,
        { method: "POST" }
      );
      setStatus(r.status === "already_provisioned" ? "Ya estaba aprovisionada" : "✓ BD aprovisionada");
      onChange();
    } catch (e: any) {
      // 503 honesto: falta AGENT_BACKEND_ADMIN_DB_URL (paso manual documentado)
      setStatus(e?.message ?? "Aprovisionamiento no disponible");
    } finally {
      setProvisioning(false);
    }
  }

  // Switch none_yet → managed_db: solo fija el modo (NO aprovisiona). Tras recargar,
  // el panel re-renderiza en modo managed_db con su UI de capacidades + Aprovisionar.
  async function switchToManagedDb() {
    setSaving(true);
    setStatus("");
    try {
      await api(`/api/agents/${agent.id}/backend`, {
        method: "PATCH",
        body: JSON.stringify({ mode: "managed_db" }),
      });
      onChange();
    } catch (e: any) {
      setStatus(e?.message ?? "Error al cambiar de modo");
    } finally {
      setSaving(false);
    }
  }

  // Guarda la config external_api. La apiKey solo se envía si el usuario escribe algo
  // (write-only): en blanco conserva la actual. Si venimos de none_yet, envía el switch de modo.
  async function saveExternalApi() {
    setSaving(true);
    setStatus("");
    try {
      const body: Record<string, unknown> = {
        apiBaseUrl: apiBaseUrl.trim(),
        businessId: businessId.trim(),
        locationId: locationId.trim(),
        capabilities: caps,
      };
      if (backend?.mode === "none_yet") body.mode = "external_api";
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      await api(`/api/agents/${agent.id}/backend`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setApiKey(""); // limpia el buffer de la key tras guardar
      setStatus("✓ API externa guardada");
      onChange();
    } catch (e: any) {
      setStatus(e?.message ?? "Error al guardar la API externa");
    } finally {
      setSaving(false);
    }
  }

  // Aviso: el adapter requiere locationId para operar reservas.
  const reservasNeedsLocation = caps.includes("reservas") && !locationId.trim();

  // Formulario external_api reutilizado por none_yet (tras el CTA) y external_api.
  const externalApiForm = (
    <div className="space-y-4 border-t border-edge pt-4">
      <p className="text-xs text-slate-500">
        Conecta el agente a un sistema externo (p.ej. otro CRM) que exponga los endpoints
        /api/public/leads, /api/public/availability y /api/public/bookings. No es una base de
        datos cruda.
      </p>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
          URL base de la API
        </label>
        <input
          className="input-dark w-full text-xs"
          type="url"
          placeholder="https://mi-negocio.ejemplo.com"
          value={apiBaseUrl}
          onChange={(e) => setApiBaseUrl(e.target.value)}
        />
        <p className="text-xs text-slate-500">
          Base del sistema del cliente; el agente le añade /api/public/…
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
          API key
        </label>
        <input
          className="input-dark w-full text-xs"
          type="password"
          autoComplete="new-password"
          placeholder={backend?.apiKeySet ? "••••••••" : "Pega la API key"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <p className="text-xs text-slate-500">Token Bearer que emite ese sistema.</p>
        {backend?.apiKeySet && (
          <p className="text-xs text-slate-500">Déjalo en blanco para conservar la actual.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Business ID (opcional)
          </label>
          <input
            className="input-dark w-full text-xs"
            type="text"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
          />
          <p className="text-xs text-slate-500">
            Qué negocio dentro de ese sistema (si es multi-tenant).
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Location ID (opcional)
          </label>
          <input
            className="input-dark w-full text-xs"
            type="text"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          />
          <p className="text-xs text-slate-500">Qué sede; obligatorio para operar reservas.</p>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">
          Capacidades habilitadas
        </h4>
        <div className="flex gap-4">
          {EXTERNAL_API_CAPABILITIES.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={caps.includes(c.id)}
                onChange={(e) =>
                  setCaps((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)))
                }
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      {reservasNeedsLocation && (
        <p className="text-xs text-amber-300">
          Para operar reservas el adapter necesita un Location ID.
        </p>
      )}

      <button
        className="btn-grad text-xs px-4 py-1.5 disabled:opacity-50"
        onClick={saveExternalApi}
        disabled={saving || !apiBaseUrl.trim()}
      >
        {saving ? "Guardando…" : "Guardar"}
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="card p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-sm text-white">Backend de datos del negocio</h3>
          <p className="text-xs text-slate-500 mt-1">
            Dónde vive la data operativa del agente (reservas, leads, pedidos) y qué puede operar.
          </p>
        </div>

        {!backend ? (
          <p className="text-xs text-amber-300">
            Este agente no tiene backend de datos declarado (creado antes de la migración). Se
            gestiona al regenerarlo desde el wizard.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="chip-accent">{MODE_LABEL[backend.mode] ?? backend.mode}</span>
              {backend.mode === "managed_db" && (
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    backend.provisioned
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                      : "border-amber-400/40 bg-amber-400/10 text-amber-300"
                  }`}
                >
                  {backend.provisioned ? "BD aprovisionada ✓" : "Pendiente de aprovisionar"}
                </span>
              )}
            </div>

            {backend.mode === "none_yet" && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Elección explícita: el agente solo informa (FAQ/RAG), sin operar datos del negocio.
                </p>
                {!showExternalForm ? (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      className="btn-grad text-xs px-4 py-1.5"
                      onClick={() => setShowExternalForm(true)}
                    >
                      Usar API externa
                    </button>
                    <button
                      className="btn-grad text-xs px-4 py-1.5 disabled:opacity-50"
                      onClick={switchToManagedDb}
                      disabled={saving}
                    >
                      {saving ? "Cambiando…" : "Usar base de datos gestionada"}
                    </button>
                  </div>
                ) : (
                  externalApiForm
                )}
              </div>
            )}

            {backend.mode === "external_api" && externalApiForm}

            {backend.mode === "managed_db" && (
              <>
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                    Capacidades habilitadas
                  </h4>
                  <div className="flex gap-4">
                    {ALL_CAPABILITIES.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={caps.includes(c.id)}
                          onChange={(e) =>
                            setCaps((prev) =>
                              e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)
                            )
                          }
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                  <button
                    className="btn-grad text-xs px-4 py-1.5 disabled:opacity-50"
                    onClick={saveCapabilities}
                    disabled={saving || !capsDirty || caps.length === 0}
                  >
                    {saving ? "Guardando…" : "Guardar capacidades"}
                  </button>
                  {caps.length === 0 && (
                    <p className="text-[11px] text-amber-300">managed_db requiere al menos una capacidad.</p>
                  )}
                </div>

                {!backend.provisioned && (
                  <div className="border-t border-edge pt-4 space-y-2">
                    <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                      Aprovisionamiento
                    </h4>
                    <p className="text-xs text-slate-500">
                      Crea el esquema estándar y el rol Postgres de mínimo privilegio del agente y
                      guarda su conexión cifrada. Las credenciales nunca se muestran.
                    </p>
                    <button
                      className="btn-grad text-xs px-4 py-1.5 disabled:opacity-50"
                      onClick={provision}
                      disabled={provisioning}
                    >
                      {provisioning ? "Aprovisionando…" : "Aprovisionar BD gestionada"}
                    </button>
                  </div>
                )}
              </>
            )}

            {status && <p className="text-xs text-slate-300">{status}</p>}
          </>
        )}
      </div>

      {/* Horario, handoff Slack y estado de pedidos legado — migrado desde la
          antigua tab Integraciones (design.md §C.2). */}
      <EcommerceConfigPanel agentId={agent.id} initial={agent.ecommerceConfig ?? {}} onChange={onChange} />
    </div>
  );
}
