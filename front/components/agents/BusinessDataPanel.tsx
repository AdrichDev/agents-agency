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
}

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
              <p className="text-xs text-slate-500">
                Elección explícita: el agente solo informa (FAQ/RAG), sin operar datos del negocio.
              </p>
            )}

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
