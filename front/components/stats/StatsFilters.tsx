"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { MONTHS_FULL } from "./periodFormat";
import { SERVICES_CATALOG } from "@/components/facturacion/types";

export interface FilterState {
  granularity: "year" | "month" | "week" | "day";
  range: "ytd" | "last12m" | "all";
  /** Single-month drilldown ("YYYY-MM"). Always available; required for day granularity. */
  month: string;
  clientId: string;
  serviceId: string;
  revenueType: "" | "impl" | "maint";
  sector: string;
}

export const DEFAULT_FILTERS: FilterState = {
  granularity: "month",
  range: "last12m",
  month: "",
  clientId: "",
  serviceId: "",
  revenueType: "",
  sector: "",
};

interface Client { id: string; name: string; sector?: string | null }

interface Props {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  /** Distinct sectors of existing clients; overrides the internally derived list. */
  sectors?: string[];
}

// Derivado del catálogo canónico (id + name) para no duplicar precios/ids.
const SERVICE_CATALOG = SERVICES_CATALOG.map((s) => ({ id: s.id, name: s.name }));

const GRANULARITY_LABELS: Record<string, string> = {
  year: "Anual", month: "Mensual", week: "Semanal", day: "Diaria",
};
const RANGE_LABELS: Record<string, string> = {
  ytd: "Año en curso", last12m: "Últimos 12 meses", all: "Todo",
};

interface MonthOption { value: string; label: string }

/** Month options for the single-month drilldown select. */
function buildMonthOptions(range: FilterState["range"]): MonthOption[] {
  const now = new Date();
  if (range === "last12m") {
    // Rolling window: each month is labeled with its year to avoid ambiguity
    const opts: MonthOption[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      opts.push({
        value: `${d.getFullYear()}-${mm}`,
        label: `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`,
      });
    }
    return opts;
  }
  // Current year: the 12 months, Enero..Diciembre
  const year = now.getFullYear();
  return MONTHS_FULL.map((label, i) => ({
    value: `${year}-${String(i + 1).padStart(2, "0")}`,
    label,
  }));
}

function chipLabel(key: keyof FilterState, value: string, clients: Client[], monthOptions: MonthOption[]): string {
  if (key === "granularity") return `Granularidad: ${GRANULARITY_LABELS[value] ?? value}`;
  if (key === "range") return `Rango: ${RANGE_LABELS[value] ?? value}`;
  if (key === "month") {
    const opt = monthOptions.find((m) => m.value === value);
    return `Mes: ${opt?.label ?? value}`;
  }
  if (key === "clientId") {
    const client = clients.find((c) => c.id === value);
    return `Cliente: ${client?.name ?? value}`;
  }
  if (key === "serviceId") {
    const svc = SERVICE_CATALOG.find((s) => s.id === value);
    return `Servicio: ${svc?.name ?? value}`;
  }
  if (key === "revenueType") {
    return `Ingresos: ${{ impl: "Implantación", maint: "Mantenimiento" }[value] ?? value}`;
  }
  if (key === "sector") return `Sector: ${value}`;
  return value;
}

export default function StatsFilters({ filters, onChange, sectors }: Props) {
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    api<Client[]>("/api/clients")
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Distinct sectors derived from existing clients (fallback when not provided)
  const sectorOptions = useMemo(() => {
    if (sectors && sectors.length > 0) return sectors;
    const set = new Set<string>();
    for (const c of clients) {
      const s = (c.sector ?? "").trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [sectors, clients]);

  const monthOptions = useMemo(() => buildMonthOptions(filters.range), [filters.range]);

  function set(key: keyof FilterState, value: string) {
    const next = { ...filters, [key]: value } as FilterState;
    // Changing range: reset month; if Anual was selected but new range != all, downgrade to Mensual
    if (key === "range") {
      next.month = "";
      if (value !== "all" && next.granularity === "year") next.granularity = "month";
    }
    // Changing the month: if day granularity and clearing month, switch to Mensual
    if (key === "month" && value === "" && next.granularity === "day") next.granularity = "month";
    onChange(next);
  }

  function removeFilter(key: keyof FilterState) {
    const next = { ...filters, [key]: DEFAULT_FILTERS[key] } as FilterState;
    if (key === "range") {
      next.month = "";
      if (next.granularity === "year") next.granularity = "month";
    }
    onChange(next);
  }

  function reset() {
    onChange({ ...DEFAULT_FILTERS });
  }

  // Chips: only filters that differ from the default view
  const activeChips = (Object.keys(filters) as (keyof FilterState)[]).filter(
    (key) => filters[key] !== DEFAULT_FILTERS[key]
  );

  const selectCls =
    "bg-[#0d0d16] border border-white/10 text-slate-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500/50 min-w-[130px]";

  return (
    <div className="card p-4 space-y-3">
      {/* Toolbar row — order: Rango → Mes → Granularidad → filters */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* 1. Rango */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500" htmlFor="stats-range">Rango</label>
          <select
            id="stats-range"
            className={selectCls}
            value={filters.range}
            onChange={(e) => set("range", e.target.value)}
          >
            <option value="ytd">Año en curso</option>
            <option value="last12m">Últimos 12 meses</option>
            <option value="all">Todo</option>
          </select>
        </div>

        {/* 2. Mes — always visible */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500" htmlFor="stats-month">Mes</label>
          <select
            id="stats-month"
            className={selectCls}
            value={filters.month}
            onChange={(e) => set("month", e.target.value)}
          >
            <option value="">Todos los meses</option>
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* 3. Granularidad — to the right of Mes; Anual only when range=all */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500" htmlFor="stats-granularity">Granularidad</label>
          <select
            id="stats-granularity"
            className={selectCls}
            value={filters.granularity}
            onChange={(e) => set("granularity", e.target.value)}
          >
            {filters.range === "all" && <option value="year">Anual</option>}
            <option value="month">Mensual</option>
            <option value="week">Semanal</option>
            <option value="day">Diaria</option>
          </select>
        </div>

        {/* Client */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500" htmlFor="stats-client">Cliente</label>
          <select
            id="stats-client"
            className={selectCls}
            value={filters.clientId}
            onChange={(e) => set("clientId", e.target.value)}
          >
            <option value="">Todos</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Service */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500" htmlFor="stats-service">Servicio</label>
          <select
            id="stats-service"
            className={selectCls}
            value={filters.serviceId}
            onChange={(e) => set("serviceId", e.target.value)}
          >
            <option value="">Todos</option>
            {SERVICE_CATALOG.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Revenue type */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500" htmlFor="stats-revenue">Tipo de ingresos</label>
          <select
            id="stats-revenue"
            className={selectCls}
            value={filters.revenueType}
            onChange={(e) => set("revenueType", e.target.value)}
          >
            <option value="">Todos</option>
            <option value="impl">Implantación</option>
            <option value="maint">Mantenimiento</option>
          </select>
        </div>

        {/* Sector — dynamic, distinct sectors of existing clients */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500" htmlFor="stats-sector">Sector</label>
          <select
            id="stats-sector"
            className={selectCls}
            value={filters.sector}
            onChange={(e) => set("sector", e.target.value)}
          >
            <option value="">Todos</option>
            {sectorOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
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
          {activeChips.map((key) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-500/20 border border-violet-500/30 rounded-full text-xs text-violet-300"
            >
              {chipLabel(key, String(filters[key]), clients, monthOptions)}
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
