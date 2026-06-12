"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

export interface FilterState {
  granularity: "year" | "month" | "week" | "";
  range: "last12m" | "ytd" | "all" | "custom" | "";
  from: string;
  to: string;
  clientId: string;
  serviceId: string;
  revenueType: "all" | "impl" | "maint" | "";
  sector: string;
}

export const EMPTY_FILTERS: FilterState = {
  granularity: "",
  range: "",
  from: "",
  to: "",
  clientId: "",
  serviceId: "",
  revenueType: "",
  sector: "",
};

interface Client { id: string; name: string }

interface Props {
  filters: FilterState;
  onChange: (f: FilterState) => void;
}

const SERVICE_CATALOG = [
  { id: "chatbot_basic", name: "Agente IA — Starter" },
  { id: "chatbot_pro", name: "Agente IA — Pro" },
  { id: "chatbot_enterprise", name: "Agente IA — Enterprise" },
  { id: "web_basic", name: "Web Profesional" },
  { id: "web_chatbot", name: "Web + Chatbot" },
  { id: "automation", name: "Automatización RPA/n8n" },
  { id: "hours", name: "Horas Desarrollo" },
  { id: "tokens", name: "Tokens IA (5M)" },
];

function chipLabel(key: keyof FilterState, value: string, clients: Client[] = []): string {
  const labels: Record<string, string> = {
    granularity: { year: "Año", month: "Mes", week: "Semana" }[value] ?? value,
    range: { last12m: "12 meses", ytd: "Año actual", all: "Todo", custom: "Rango custom" }[value] ?? value,
    revenueType: { all: "Todo", impl: "Implantación", maint: "Mantenimiento" }[value] ?? value,
  };
  if (key === "from") return `Desde: ${value}`;
  if (key === "to") return `Hasta: ${value}`;
  if (key === "clientId") {
    const client = clients.find((c) => c.id === value);
    return `Cliente: ${client?.name ?? value}`;
  }
  if (key === "serviceId") {
    const svc = SERVICE_CATALOG.find((s) => s.id === value);
    return `Servicio: ${svc?.name ?? value}`;
  }
  if (key === "sector") return `Sector: ${value}`;
  return labels[key] ?? value;
}

export default function StatsFilters({ filters, onChange }: Props) {
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    api<Client[]>("/api/clients").then(setClients).catch(() => {});
  }, []);

  function set(key: keyof FilterState, value: string) {
    onChange({ ...filters, [key]: value });
  }

  function removeFilter(key: keyof FilterState) {
    const next = { ...filters, [key]: "" };
    if (key === "range") { next.from = ""; next.to = ""; }
    onChange(next);
  }

  function reset() {
    onChange({ ...EMPTY_FILTERS });
  }

  const activeChips = (Object.entries(filters) as [keyof FilterState, string][]).filter(
    ([, v]) => v !== ""
  );

  const selectCls =
    "bg-[#0d0d16] border border-white/10 text-slate-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500/50 min-w-[120px]";

  return (
    <div className="card p-4 space-y-3">
      {/* Toolbar row */}
      <div className="flex flex-wrap gap-2 items-end">
        {/* Granularity */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Granularidad</label>
          <select className={selectCls} value={filters.granularity} onChange={(e) => set("granularity", e.target.value)}>
            <option value="">Mensual</option>
            <option value="year">Anual</option>
            <option value="month">Mensual</option>
            <option value="week">Semanal (ISO)</option>
          </select>
        </div>

        {/* Range */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Rango</label>
          <select className={selectCls} value={filters.range} onChange={(e) => set("range", e.target.value)}>
            <option value="">Últimos 12m</option>
            <option value="last12m">Últimos 12 meses</option>
            <option value="ytd">Año en curso</option>
            <option value="all">Todo</option>
            <option value="custom">Rango custom</option>
          </select>
        </div>

        {/* Custom date range */}
        {filters.range === "custom" && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Desde</label>
              <input type="date" className={selectCls} value={filters.from} onChange={(e) => set("from", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Hasta</label>
              <input type="date" className={selectCls} value={filters.to} onChange={(e) => set("to", e.target.value)} />
            </div>
          </>
        )}

        {/* Client */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Cliente</label>
          <select className={selectCls} value={filters.clientId} onChange={(e) => set("clientId", e.target.value)}>
            <option value="">Todos</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Service */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Servicio</label>
          <select className={selectCls} value={filters.serviceId} onChange={(e) => set("serviceId", e.target.value)}>
            <option value="">Todos</option>
            {SERVICE_CATALOG.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Revenue type */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Tipo ingresos</label>
          <select className={selectCls} value={filters.revenueType} onChange={(e) => set("revenueType", e.target.value)}>
            <option value="">Todo</option>
            <option value="impl">Implantación</option>
            <option value="maint">Mantenimiento</option>
          </select>
        </div>

        {/* Sector */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Sector</label>
          <input
            type="text"
            placeholder="p.ej. retail"
            className={selectCls}
            value={filters.sector}
            onChange={(e) => set("sector", e.target.value)}
          />
        </div>

        {/* Reset */}
        {activeChips.length > 0 && (
          <button
            onClick={reset}
            className="btn-ghost text-xs px-3 py-1.5 self-end rounded-lg border border-white/10 text-slate-400 hover:text-white hover:border-white/20"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Active chips */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeChips.map(([key, value]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-500/20 border border-violet-500/30 rounded-full text-xs text-violet-300"
            >
              {chipLabel(key, value, clients)}
              <button
                onClick={() => removeFilter(key)}
                className="ml-0.5 text-violet-400 hover:text-white leading-none"
                aria-label={`Quitar filtro ${key}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
