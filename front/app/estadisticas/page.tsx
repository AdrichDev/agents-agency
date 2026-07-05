"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import KpiCard from "@/components/stats/KpiCard";
import MonthlyBarChart from "@/components/stats/MonthlyBarChart";
import BillingBarChart from "@/components/stats/BillingBarChart";
import DonutChart from "@/components/stats/DonutChart";
import TopAgentsChart from "@/components/stats/TopAgentsChart";
import StatsFilters, { FilterState, DEFAULT_FILTERS } from "@/components/stats/StatsFilters";
import DrilldownPanel, { DrilldownData } from "@/components/stats/DrilldownPanel";
import { MONTHS_FULL, type PeriodMode } from "@/components/stats/periodFormat";

// ── Types (mirror of back/src/lib/stats.ts) ──────────────────────────────

interface SkillTypeCount { type: string; count: number }

interface Totals {
  agents: number; clients: number; skills: number;
  skillsByType: SkillTypeCount[]; leads: number;
  leadsByStatus: Record<string, number>; conversations: number;
  messages: number; automations: number; budgets: number;
}

interface MonthlyPoint { month: string; agents: number; leads: number; conversations: number; budgets: number }
interface BillingMonthPoint { month: string; total: number; draft: number; sent: number; accepted: number; rejected: number }
interface BillingTotals { total: number; draft: number; sent: number; accepted: number; rejected: number }
interface Billing { monthly: BillingMonthPoint[]; totals: BillingTotals }
interface TopAgent { agentId: string; agentName: string; conversations: number }

interface StatsResponse {
  totals: Totals; monthly: MonthlyPoint[]; billing: Billing; topAgents: TopAgent[];
}

// ── Color palettes ───────────────────────────────────────────────────────

const SKILL_TYPE_COLORS = ["#9d00ff", "#d946ef", "#0066ff", "#00f0ff", "#ff9900"];

// One unique, distinguishable color per lead status — never reused
const LEAD_STATUS_COLORS: Record<string, string> = {
  new: "#9d00ff",       // violeta
  contacted: "#0066ff", // azul
  qualified: "#00f0ff", // cian
  converted: "#00c47a", // verde
  lost: "#ff3b5c",      // rojo
};
const LEAD_STATUS_EXTRA = ["#ff9900", "#d946ef", "#facc15", "#34d399", "#f472b6", "#8b8baf"];

const LEAD_STATUS_LABELS: Record<string, string> = {
  new: "Nuevo",
  contacted: "Contactado",
  qualified: "Cualificado",
  converted: "Convertido",
  lost: "Perdido",
};

const RANGE_SUBTITLES: Record<FilterState["range"], string> = {
  ytd: "Año en curso",
  last12m: "Últimos 12 meses",
  all: "Histórico completo",
};

function euroFmt(n: number) {
  return n.toLocaleString("es-ES", { maximumFractionDigits: 0 }) + " €";
}

/** Bounds of a "YYYY-MM" month. `to` includes the whole last day (UTC). */
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map((n) => parseInt(n, 10));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`,
  };
}

function buildQueryString(filters: FilterState): string {
  const params = new URLSearchParams();
  if (filters.granularity === "month" && filters.month) {
    // Single-month view: one point per day of the selected month
    const { from, to } = monthBounds(filters.month);
    params.set("granularity", "day");
    params.set("range", "custom");
    params.set("from", from);
    params.set("to", to);
  } else {
    params.set("granularity", filters.granularity);
    params.set("range", filters.range);
  }
  if (filters.clientId) params.set("clientId", filters.clientId);
  if (filters.serviceId) params.set("serviceId", filters.serviceId);
  if (filters.revenueType) params.set("revenueType", filters.revenueType);
  if (filters.sector) params.set("sector", filters.sector);
  return `?${params.toString()}`;
}

/** Runtime guard: the API can answer `{ error }` (400/500) with the same 200-ish
 *  json body — never trust the shape blindly (fixes "reading 'skillsByType'"). */
function isStatsResponse(data: unknown): data is StatsResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Partial<StatsResponse> & { error?: unknown };
  return !d.error && typeof d.totals === "object" && d.totals !== null;
}

/** Assign a unique color per lead status, even for unknown statuses. */
function leadStatusPalette(statuses: string[]): string[] {
  const assigned = new Set<string>();
  return statuses.map((status) => {
    const preferred = LEAD_STATUS_COLORS[status];
    if (preferred && !assigned.has(preferred)) {
      assigned.add(preferred);
      return preferred;
    }
    const next =
      LEAD_STATUS_EXTRA.find((c) => !assigned.has(c)) ??
      Object.values(LEAD_STATUS_COLORS).find((c) => !assigned.has(c)) ??
      "#64748b";
    assigned.add(next);
    return next;
  });
}

// ── Component ────────────────────────────────────────────────────────────

export default function EstadisticasPage() {
  // Dashboard state
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  // Drilldown state
  const [drilldown, setDrilldown] = useState<DrilldownData | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const fetchStats = useCallback((f: FilterState) => {
    setLoading(true);
    setError(null);
    const qs = buildQueryString(f);
    api<unknown>(`/api/stats${qs}`)
      .then((data) => {
        if (isStatsResponse(data)) {
          setStats(data);
        } else {
          const msg = (data as { error?: unknown })?.error;
          setStats(null);
          setError(typeof msg === "string" ? msg : "No se pudieron cargar las estadísticas");
        }
        setLoading(false);
      })
      .catch((e) => {
        setStats(null);
        setError(e?.message ?? "Error al cargar estadísticas");
        setLoading(false);
      });
  }, []);

  useEffect(() => { fetchStats(DEFAULT_FILTERS); }, [fetchStats]);

  function handleFilterChange(f: FilterState) {
    setFilters(f);
    setDrilldown(null);
    fetchStats(f);
  }

  function handleBarClick(entry: { activeLabel?: string }) {
    if (!entry?.activeLabel) return;
    const period = entry.activeLabel;
    setDrillLoading(true);
    setDrilldown(null);

    const params = new URLSearchParams({ period });
    if (filters.clientId) params.set("clientId", filters.clientId);
    if (filters.serviceId) params.set("serviceId", filters.serviceId);
    if (filters.sector) params.set("sector", filters.sector);

    api<DrilldownData>(`/api/stats/drilldown?${params.toString()}`)
      .then((data) => { setDrilldown(data); setDrillLoading(false); })
      .catch(() => { setDrillLoading(false); });
  }

  // ── Chart period mode + dynamic titles ──────────────────────────────
  const monthDetail = filters.granularity === "month" && filters.month !== "";
  const periodMode: PeriodMode = {
    granularity: monthDetail ? "day" : filters.granularity,
    range: filters.range,
  };

  const monthDetailLabel = monthDetail
    ? (() => {
        const [y, m] = filters.month.split("-");
        return `${MONTHS_FULL[parseInt(m, 10) - 1]} ${y}`;
      })()
    : null;

  const chartSubtitle = monthDetailLabel
    ? `Detalle diario · ${monthDetailLabel}`
    : RANGE_SUBTITLES[filters.range];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <span className="kicker">Panel de estadísticas</span>
          <h1 className="text-2xl font-bold text-white mt-1">Estadísticas</h1>
        </div>
      </div>

      {/* Filter toolbar */}
      <StatsFilters filters={filters} onChange={handleFilterChange} />

      {loading && (
        <div className="space-y-6" aria-busy="true">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card p-5 animate-pulse">
                <div className="h-3 w-16 bg-white/10 rounded mb-3" />
                <div className="h-8 w-12 bg-white/10 rounded" />
              </div>
            ))}
          </div>
          <div className="card p-5 animate-pulse h-[320px]" />
          <div className="card p-5 animate-pulse h-[320px]" />
        </div>
      )}

      {!loading && (error || !stats) && (
        <div className="card p-8 text-center max-w-md mx-auto space-y-3">
          <p className="text-red-400 text-sm">{error ?? "Sin datos disponibles"}</p>
          <button
            onClick={() => fetchStats(filters)}
            className="btn-ghost text-xs px-4 py-2 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:border-white/20"
          >
            Reintentar
          </button>
        </div>
      )}

      {!loading && stats && (() => {
            // Defensive defaults: shape can degrade if API contract drifts
            const totals = stats.totals ?? ({} as Partial<Totals>);
            const monthly = Array.isArray(stats.monthly) ? stats.monthly : [];
            const billingMonthly = Array.isArray(stats.billing?.monthly) ? stats.billing.monthly : [];
            const billingTotals: BillingTotals =
              stats.billing?.totals ?? { total: 0, draft: 0, sent: 0, accepted: 0, rejected: 0 };
            const topAgents = Array.isArray(stats.topAgents) ? stats.topAgents : [];

            const skillTypeData = (totals.skillsByType ?? []).map((s) => ({ name: s.type, value: s.count }));
            const leadStatusEntries = Object.entries(totals.leadsByStatus ?? {});
            const leadStatusData = leadStatusEntries.map(([name, value]) => ({
              name: LEAD_STATUS_LABELS[name] ?? name,
              value,
            }));
            const leadStatusColors = leadStatusPalette(leadStatusEntries.map(([name]) => name));

            const acceptedRatio = billingTotals.total > 0
              ? `${((billingTotals.accepted / billingTotals.total) * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} % del total emitido`
              : "Sin facturación emitida";

            return (
              <div className="space-y-8">
                {/* KPI cards */}
                <section aria-label="Indicadores clave" className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    <KpiCard label="Agentes" value={totals.agents ?? 0} accent="#9d00ff" />
                    <KpiCard label="Clientes" value={totals.clients ?? 0} accent="#0066ff" />
                    <KpiCard label="Skills" value={totals.skills ?? 0} accent="#00f0ff" />
                    <KpiCard label="Leads" value={totals.leads ?? 0} accent="#d946ef" />
                    <KpiCard label="Conversaciones" value={totals.conversations ?? 0} accent="#ff9900" />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    <KpiCard label="Mensajes" value={totals.messages ?? 0} accent="#8b8baf" />
                    <KpiCard label="Automatizaciones" value={totals.automations ?? 0} accent="#9d00ff" />
                    <KpiCard label="Presupuestos" value={totals.budgets ?? 0} accent="#0066ff" />
                    <KpiCard
                      label="Facturación aceptada"
                      value={euroFmt(billingTotals.accepted)}
                      sub={`Emitido: ${euroFmt(billingTotals.total)} · ${acceptedRatio}`}
                      accent="#00c47a"
                    />
                  </div>
                </section>

                {/* Activity chart — click on a bar to drill down */}
                <MonthlyBarChart
                  data={monthly}
                  mode={periodMode}
                  title="Actividad"
                  subtitle={`${chartSubtitle} · clic en una barra para ver el detalle`}
                  onBarClick={handleBarClick}
                />

                {/* Billing chart — click to drill down */}
                <BillingBarChart
                  data={billingMonthly}
                  mode={periodMode}
                  title="Facturación por estado"
                  subtitle={chartSubtitle}
                  onBarClick={handleBarClick}
                />

                {/* Drilldown panel */}
                {(drillLoading || drilldown) && (
                  <DrilldownPanel
                    data={drilldown}
                    loading={drillLoading}
                    onClose={() => { setDrilldown(null); setDrillLoading(false); }}
                  />
                )}

                {/* Donuts + Top agents */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {skillTypeData.length > 0 ? (
                    <DonutChart title="Skills por tipo" data={skillTypeData} colors={SKILL_TYPE_COLORS} totalLabel="skills" />
                  ) : (
                    <div className="card p-5 flex flex-col items-center justify-center gap-1 min-h-[200px]">
                      <p className="text-slate-400 text-sm">Sin datos de skills</p>
                      <p className="text-slate-600 text-xs">Crea skills para ver su distribución por tipo</p>
                    </div>
                  )}

                  {leadStatusData.length > 0 ? (
                    <DonutChart title="Leads por estado" data={leadStatusData} colors={leadStatusColors} totalLabel="leads" />
                  ) : (
                    <div className="card p-5 flex flex-col items-center justify-center gap-1 min-h-[200px]">
                      <p className="text-slate-400 text-sm">Sin datos de leads</p>
                      <p className="text-slate-600 text-xs">Los leads captados aparecerán aquí por estado</p>
                    </div>
                  )}

                  {topAgents.length > 0 ? (
                    <TopAgentsChart data={topAgents} />
                  ) : (
                    <div className="card p-5 flex flex-col items-center justify-center gap-1 min-h-[200px]">
                      <p className="text-slate-400 text-sm">Sin conversaciones aún</p>
                      <p className="text-slate-600 text-xs">El ranking de agentes se calcula con sus conversaciones</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
    </div>
  );
}

