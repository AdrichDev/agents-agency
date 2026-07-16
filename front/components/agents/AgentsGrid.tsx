"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { TokenSwitch } from "@/components/TokenSwitch";

/**
 * Grid reutilizable de agentes (extraída de dashboard/page.tsx,
 * aa-dashboard-agents-nav-widgets T1.1). Consume GET /api/agents e incluye
 * buscador, filtro de sector, tarjetas y TokenSwitch.
 *
 * Modo resumen: al pasar `limit`, oculta los controles de filtro y recorta las
 * tarjetas a las primeras N (uso desde el widget del Dashboard). Sin `limit`
 * renderiza la grid completa con controles (uso desde la página /agents).
 */

export interface AgentRow {
  id: string;
  name: string;
  sector: string;
  client?: {
    id: string;
    name: string;
    isActive: boolean;
    tokenBalance: number;
    tokensUsed: number;
  } | null;
  integrations: { provider: string }[];
  _count: { conversations: number; automations: number; knowledge: number; leads: number };
}

const ICONS: Record<string, string> = {
  gmail: "✉️",
  slack: "💬",
  jira: "📋",
  calendar: "📅",
};

interface AgentsGridProps {
  /** Modo resumen: limita el nº de tarjetas y oculta los controles de filtro. */
  limit?: number;
}

export function AgentsGrid({ limit }: AgentsGridProps) {
  const summary = limit != null;
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [selectedSector, setSelectedSector] = useState("Todos");

  useEffect(() => {
    api<AgentRow[]>("/api/agents")
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);

  // Sectores únicos para el desplegable (solo relevante en modo completo).
  const sectors = [
    "Todos",
    ...Array.from(new Set(agents?.map((a) => a.sector).filter(Boolean) || [])),
  ];

  const filteredAgents = (agents ?? []).filter((a) => {
    const matchesSearch =
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.client?.name || "").toLowerCase().includes(search.toLowerCase());
    const matchesSector =
      selectedSector === "Todos" || a.sector === selectedSector;
    return matchesSearch && matchesSector;
  });

  // En modo resumen se recorta a las primeras N (los controles quedan ocultos).
  const visibleAgents = summary ? filteredAgents.slice(0, limit) : filteredAgents;

  return (
    <div>
      {!summary && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="kicker !text-slate-300 !text-sm">Tus agentes</h2>
            <p className="text-sm text-slate-500 mt-1">
              Gestiona, prueba y despliega tus asistentes de Inteligencia
              Artificial.
            </p>
          </div>

          {/* Controles de Filtros */}
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              placeholder="Buscar agente..."
              className="input-dark !w-48 !py-1.5"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="input-dark !w-40 !py-1.5 cursor-pointer"
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
            >
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {!agents ? (
        <p className="text-slate-500">Cargando agentes...</p>
      ) : filteredAgents.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl border-2 border-dashed border-slate-700 grid place-items-center text-2xl text-slate-600">
            ✦
          </div>
          <p className="text-white font-semibold mb-1">
            Sin agentes coincidentes
          </p>
          <p className="text-sm text-slate-500 mb-5">
            Prueba a cambiar los filtros o crea un nuevo agente.
          </p>
          <Link
            href="/agents/new"
            className="text-indigo-400 text-sm hover:underline"
          >
            Ir al wizard de creación →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleAgents.map((a) => (
            <Link
              key={a.id}
              href={`/agents/${a.id}`}
              className="card p-5 transition hover:bg-white/[0.04] hover:border-indigo-500/50 group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-white group-hover:text-indigo-300 transition">
                    {a.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    {/* Switch toggle: on/off con colores verde/rojo */}
                    {a.client && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <TokenSwitch
                          clientId={a.client.id}
                          isActive={a.client.isActive}
                          tokenBalance={a.client.tokenBalance}
                          tokensUsed={a.client.tokensUsed}
                        />
                      </div>
                    )}
                    <span className="chip-accent">{a.sector}</span>
                  </div>
                </div>
                {a.client && (
                  <p className="text-sm text-slate-400 mb-2">
                    Cliente: {a.client.name}
                  </p>
                )}
                <div className="text-lg mb-6">
                  {a.integrations.map((i) => (
                    <span
                      key={i.provider}
                      className="mr-1.5"
                      title={i.provider}
                    >
                      {ICONS[i.provider] ?? "🔌"}
                    </span>
                  ))}
                  {a.integrations.length === 0 && (
                    <span className="text-xs text-slate-600">
                      Sin integraciones
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-4 text-[11px] text-slate-500 border-t border-edge pt-3 mt-auto">
                <span>💬 {a._count.conversations} chats</span>
                <span>⚙️ {a._count.automations} autom.</span>
                <span>📚 {a._count.knowledge} chunks</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
