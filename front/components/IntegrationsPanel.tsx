"use client";

import { API, api } from "@/lib/api";

const PROVIDERS = [
  { id: "gmail", name: "Gmail", icon: "✉️", desc: "Leer, clasificar, archivar y enviar emails" },
  { id: "calendar", name: "Google Calendar", icon: "📅", desc: "Ver y crear eventos" },
  { id: "slack", name: "Slack", icon: "💬", desc: "Enviar y leer mensajes de canales" },
  { id: "jira", name: "Jira", icon: "📋", desc: "Crear y buscar tickets" },
];

export default function IntegrationsPanel({
  agentId,
  connected,
  onChange,
}: {
  agentId: string;
  connected: string[];
  onChange: () => void;
}) {
  async function disconnect(provider: string) {
    await api("/api/integrations", {
      method: "DELETE",
      body: JSON.stringify({ agentId, provider }),
    });
    onChange();
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {PROVIDERS.map((p) => {
        const isConnected = connected.includes(p.id);
        return (
          <div key={p.id} className="card p-5 flex items-center gap-4">
            <span className="text-3xl">{p.icon}</span>
            <div className="flex-1">
              <h3 className="font-semibold text-sm text-white">{p.name}</h3>
              <p className="text-xs text-slate-500">{p.desc}</p>
            </div>
            {isConnected ? (
              <button
                onClick={() => disconnect(p.id)}
                className="text-xs border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 px-3 py-1.5 rounded-lg hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 transition"
                title="Clic para desconectar"
              >
                ✓ Conectado
              </button>
            ) : (
              <a href={`${API}/api/oauth/${p.id}?agentId=${agentId}`} className="btn-grad !px-3 !py-1.5 !text-xs">
                Conectar
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
