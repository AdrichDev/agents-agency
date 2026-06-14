"use client";

import { useEffect, useState } from "react";
import { API, api } from "@/lib/api";
import { useDialogs } from "@/components/ui/ConfirmProvider";

interface IntegrationStatus {
  provider: string;
  status: "connected" | "reauth_required" | "disconnected";
  accountLabel: string | null;
}

interface ProviderMeta {
  id: string;
  name: string;
  icon: string;
  desc: string;
  upcoming?: boolean;
}

const PROVIDER_META: ProviderMeta[] = [
  { id: "google",  name: "Google",  icon: "🔵", desc: "Gmail + Google Calendar" },
  { id: "slack",   name: "Slack",   icon: "💬", desc: "Enviar y leer mensajes de canales" },
  { id: "notion",  name: "Notion",  icon: "📝", desc: "Crear páginas y consultar bases de datos" },
  { id: "jira",    name: "Jira",    icon: "🎫", desc: "Crear y buscar tickets", upcoming: true },
  { id: "instagram", name: "Instagram", icon: "📸", desc: "Publicar contenido", upcoming: true },
];

export default function IntegrationsPanel({
  agentId,
  onChange,
}: {
  agentId: string;
  /** @deprecated Pasar connected ya no es necesario; se usa el endpoint /status */
  connected?: string[];
  onChange: () => void;
}) {
  const { confirm } = useDialogs();
  const [statuses, setStatuses] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadStatuses() {
    setLoading(true);
    try {
      const data = await api<{ integrations: IntegrationStatus[] }>(
        `/api/integrations/${agentId}/status`
      );
      setStatuses(data.integrations ?? []);
    } catch {
      setStatuses([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadStatuses(); }, [agentId]);

  async function disconnect(provider: string) {
    const ok = await confirm({
      title: "Desconectar integración",
      message: `¿Desconectar ${provider}? El agente perderá acceso a este servicio.`,
      confirmText: "Desconectar",
      danger: true,
    });
    if (!ok) return;
    await api("/api/integrations", {
      method: "DELETE",
      body: JSON.stringify({ agentId, provider }),
    });
    await loadStatuses();
    onChange();
  }

  function getStatus(provider: string): IntegrationStatus {
    return (
      statuses.find((s) => s.provider === provider) ?? {
        provider,
        status: "disconnected",
        accountLabel: null,
      }
    );
  }

  if (loading) {
    return <div className="text-slate-500 text-sm">Cargando integraciones…</div>;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-white">Integraciones OAuth</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PROVIDER_META.map((p) => {
          const s = getStatus(p.id);

          return (
            <div key={p.id} className="card p-5 flex items-center gap-4">
              <span className="text-3xl">{p.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm text-white">{p.name}</h3>
                  {p.upcoming && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-400">
                      Próximamente
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">{p.desc}</p>
                {s.status === "connected" && s.accountLabel && (
                  <p className="text-xs text-emerald-400 mt-0.5 truncate">{s.accountLabel}</p>
                )}
                {s.status === "reauth_required" && (
                  <p className="text-xs text-amber-400 mt-0.5">
                    El acceso fue revocado o caducó — vuelve a conectar
                  </p>
                )}
              </div>

              {/* Botones según estado */}
              {p.upcoming ? (
                <button
                  disabled
                  className="text-xs border border-white/10 bg-white/5 text-slate-600 px-3 py-1.5 rounded-lg cursor-not-allowed"
                  title="Disponible próximamente"
                >
                  Conectar
                </button>
              ) : s.status === "connected" ? (
                <button
                  onClick={() => disconnect(p.id)}
                  className="text-xs border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 px-3 py-1.5 rounded-lg hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 transition"
                  title="Clic para desconectar"
                >
                  ✓ Conectado
                </button>
              ) : s.status === "reauth_required" ? (
                <a
                  href={`${API}/api/oauth/${p.id}?agentId=${agentId}`}
                  className="text-xs border border-amber-500/40 bg-amber-500/10 text-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-500/20 transition"
                >
                  Volver a conectar
                </a>
              ) : (
                <a
                  href={`${API}/api/oauth/${p.id}?agentId=${agentId}`}
                  className="btn-grad !px-3 !py-1.5 !text-xs"
                >
                  Conectar
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
