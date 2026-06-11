"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { api } from "@/lib/api";

interface AgentRow {
  id: string;
  name: string;
  sector: string;
  client?: { name: string } | null;
  integrations: { provider: string }[];
  _count: { conversations: number; automations: number; knowledge: number };
}

const ICONS: Record<string, string> = { gmail: "✉️", slack: "💬", jira: "📋", calendar: "📅" };

export default function Dashboard() {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const search = searchParams.get("q") || "";
  const [selectedSector, setSelectedSector] = useState("Todos");

  const setSearch = (val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val) {
      params.set("q", val);
    } else {
      params.delete("q");
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  useEffect(() => {
    api<AgentRow[]>("/api/agents").then(setAgents).catch(() => setAgents([]));
  }, []);

  const totalAgents = agents?.length || 0;
  const totalChats = agents?.reduce((acc, a) => acc + (a._count?.conversations || 0), 0) || 0;
  const totalAutomations = agents?.reduce((acc, a) => acc + (a._count?.automations || 0), 0) || 0;
  const totalKnowledge = agents?.reduce((acc, a) => acc + (a._count?.knowledge || 0), 0) || 0;

  // Filtrado de sectores único
  const sectors = ["Todos", ...Array.from(new Set(agents?.map((a) => a.sector).filter(Boolean) || []))];

  const filteredAgents = agents?.filter((a) => {
    const matchesSearch = a.name.toLowerCase().includes(search.toLowerCase()) || 
      (a.client?.name || "").toLowerCase().includes(search.toLowerCase());
    const matchesSector = selectedSector === "Todos" || a.sector === selectedSector;
    return matchesSearch && matchesSector;
  });

  return (
    <div>
      <section className="card relative overflow-hidden p-10 mb-10">
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-purple-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 right-40 w-72 h-72 bg-indigo-600/20 rounded-full blur-3xl" />
        <div className="relative">
          <div className="kicker mb-4">Estudio</div>
          <h1 className="text-4xl font-extrabold text-white leading-tight">
            Bienvenido de vuelta, Adrián.
          </h1>
          <p className="text-3xl font-light text-slate-400 mb-8">
            Continúa creando con{" "}
            <span className="font-bold bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">
              IA
            </span>
            .
          </p>
          <div className="flex gap-3">
            <Link href="/agents/new" className="btn-grad">✦ Nuevo Agente</Link>
            <Link href="/skills" className="btn-dark">◈ Marketplace de skills</Link>
          </div>
        </div>
      </section>

      {/* Indicadores de métricas del panel */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <div className="card p-5 flex flex-col justify-between">
          <span className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Total Agentes</span>
          <h3 className="text-3xl font-black text-white mt-2">{totalAgents}</h3>
        </div>
        <div className="card p-5 flex flex-col justify-between">
          <span className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Conversaciones</span>
          <h3 className="text-3xl font-black text-white mt-2">{totalChats}</h3>
        </div>
        <div className="card p-5 flex flex-col justify-between">
          <span className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Automatizaciones</span>
          <h3 className="text-3xl font-black text-white mt-2">{totalAutomations}</h3>
        </div>
        <div className="card p-5 flex flex-col justify-between">
          <span className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Conocimiento (chunks)</span>
          <h3 className="text-3xl font-black text-white mt-2">{totalKnowledge}</h3>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="kicker !text-slate-300 !text-sm">Tus agentes</h2>
          <p className="text-sm text-slate-500 mt-1">
            Gestiona, prueba y despliega tus asistentes de Inteligencia Artificial.
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
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {!agents ? (
        <p className="text-slate-500">Cargando agentes...</p>
      ) : filteredAgents?.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl border-2 border-dashed border-slate-700 grid place-items-center text-2xl text-slate-600">
            ✦
          </div>
          <p className="text-white font-semibold mb-1">Sin agentes coincidentes</p>
          <p className="text-sm text-slate-500 mb-5">
            Prueba a cambiar los filtros o crea un nuevo agente.
          </p>
          <Link href="/agents/new" className="text-indigo-400 text-sm hover:underline">
            Ir al wizard de creación →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAgents?.map((a) => (
            <Link key={a.id} href={`/agents/${a.id}`} className="card p-5 transition hover:bg-white/[0.04] hover:border-indigo-500/50 group flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-white group-hover:text-indigo-300 transition">
                    {a.name}
                  </h3>
                  <span className="chip-accent">{a.sector}</span>
                </div>
                {a.client && <p className="text-sm text-slate-400 mb-2">Cliente: {a.client.name}</p>}
                <div className="text-lg mb-6">
                  {a.integrations.map((i) => (
                    <span key={i.provider} className="mr-1.5" title={i.provider}>
                      {ICONS[i.provider] ?? "🔌"}
                    </span>
                  ))}
                  {a.integrations.length === 0 && <span className="text-xs text-slate-600">Sin integraciones</span>}
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
