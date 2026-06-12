"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import KpiCard from "@/components/stats/KpiCard";
import MonthlyBarChart from "@/components/stats/MonthlyBarChart";
import BillingBarChart from "@/components/stats/BillingBarChart";
import DonutChart from "@/components/stats/DonutChart";
import TopAgentsChart from "@/components/stats/TopAgentsChart";
import StatsFilters, { FilterState, EMPTY_FILTERS } from "@/components/stats/StatsFilters";
import DrilldownPanel, { DrilldownData } from "@/components/stats/DrilldownPanel";
import StarRating from "@/components/stats/StarRating";

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
const LEAD_STATUS_COLORS: Record<string, string> = {
  new: "#9d00ff", contacted: "#0066ff", qualified: "#00f0ff", converted: "#00c47a", lost: "#ff3b5c",
};
const LEAD_STATUS_FALLBACK = ["#9d00ff", "#0066ff", "#00f0ff", "#00c47a", "#ff3b5c", "#ff9900"];

function euroFmt(n: number) {
  return n.toLocaleString("es-ES", { maximumFractionDigits: 0 }) + " €";
}

function buildQueryString(filters: FilterState): string {
  const params = new URLSearchParams();
  if (filters.granularity) params.set("granularity", filters.granularity);
  if (filters.range) params.set("range", filters.range);
  if (filters.range === "custom" && filters.from) params.set("from", filters.from);
  if (filters.range === "custom" && filters.to) params.set("to", filters.to);
  if (filters.clientId) params.set("clientId", filters.clientId);
  if (filters.serviceId) params.set("serviceId", filters.serviceId);
  if (filters.revenueType) params.set("revenueType", filters.revenueType);
  if (filters.sector) params.set("sector", filters.sector);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

type Tab = "dashboard" | "estudios";

// ── Component ────────────────────────────────────────────────────────────

export default function EstadisticasPage() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  // Dashboard state
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  // Drilldown state
  const [drilldown, setDrilldown] = useState<DrilldownData | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  // Studies state
  const [studies, setStudies] = useState<any[]>([]);
  const [studiesLoading, setStudiesLoading] = useState(false);
  const [studiesError, setStudiesError] = useState<string | null>(null);

  const fetchStats = useCallback((f: FilterState) => {
    setLoading(true);
    setError(null);
    const qs = buildQueryString(f);
    api<StatsResponse>(`/api/stats${qs}`)
      .then((data) => { setStats(data); setLoading(false); })
      .catch((e) => { setError(e?.message ?? "Error al cargar estadísticas"); setLoading(false); });
  }, []);

  useEffect(() => { fetchStats(EMPTY_FILTERS); }, [fetchStats]);

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

  const fetchStudies = useCallback(() => {
    setStudiesLoading(true);
    setStudiesError(null);
    api<any[]>("/api/market-studies")
      .then((data) => { setStudies(data); setStudiesLoading(false); })
      .catch((e) => { setStudiesError(e?.message ?? "Error al cargar estudios"); setStudiesLoading(false); });
  }, []);

  useEffect(() => {
    if (activeTab === "estudios") fetchStudies();
  }, [activeTab, fetchStudies]);

  async function handleDeleteStudy(id: string) {
    if (!confirm("¿Eliminar este estudio? Esta acción no se puede deshacer.")) return;
    try {
      await api(`/api/market-studies/${id}`, { method: "DELETE" });
      setStudies((prev) => prev.filter((s) => s.id !== id));
    } catch {
      alert("Error al eliminar el estudio");
    }
  }

  // ── Tab nav ─────────────────────────────────────────────────────────
  const tabCls = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === t
      ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
      : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
    }`;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <span className="kicker">Panel de estadísticas</span>
          <h1 className="text-2xl font-bold text-white mt-1">Estadísticas</h1>
        </div>
        <div className="flex gap-2">
          <button className={tabCls("dashboard")} onClick={() => setActiveTab("dashboard")}>
            Dashboard
          </button>
          <button className={tabCls("estudios")} onClick={() => setActiveTab("estudios")}>
            Estudios de mercado
          </button>
        </div>
      </div>

      {/* ── DASHBOARD TAB ─────────────────────────────────────────────── */}
      {activeTab === "dashboard" && (
        <>
          {/* Filter toolbar */}
          <StatsFilters filters={filters} onChange={handleFilterChange} />

          {loading && (
            <div className="flex items-center justify-center min-h-[40vh]">
              <span className="text-slate-500 animate-pulse text-sm">Cargando estadísticas…</span>
            </div>
          )}

          {!loading && (error || !stats) && (
            <div className="card p-6 text-center max-w-sm mx-auto">
              <p className="text-red-400 text-sm">{error ?? "Sin datos"}</p>
            </div>
          )}

          {!loading && stats && (() => {
            const { totals, monthly, billing, topAgents } = stats;
            const skillTypeData = totals.skillsByType.map((s) => ({ name: s.type, value: s.count }));
            const leadStatusEntries = Object.entries(totals.leadsByStatus);
            const leadStatusData = leadStatusEntries.map(([name, value]) => ({ name, value }));
            const leadStatusColors = leadStatusEntries.map(
              ([name], i) => LEAD_STATUS_COLORS[name] ?? LEAD_STATUS_FALLBACK[i % LEAD_STATUS_FALLBACK.length]
            );

            return (
              <div className="space-y-8">
                {/* KPI cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                  <KpiCard label="Agentes" value={totals.agents} accent="#9d00ff" />
                  <KpiCard label="Clientes" value={totals.clients} accent="#0066ff" />
                  <KpiCard label="Skills" value={totals.skills} accent="#00f0ff" />
                  <KpiCard label="Leads" value={totals.leads} accent="#d946ef" />
                  <KpiCard label="Conversaciones" value={totals.conversations} accent="#ff9900" />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  <KpiCard label="Mensajes" value={totals.messages} accent="#8b8baf" />
                  <KpiCard label="Automatizaciones" value={totals.automations} accent="#9d00ff" />
                  <KpiCard label="Presupuestos" value={totals.budgets} accent="#0066ff" />
                  <KpiCard
                    label="Facturación aceptada"
                    value={euroFmt(billing.totals.accepted)}
                    sub={`Total emitido: ${euroFmt(billing.totals.total)}`}
                    accent="#00c47a"
                  />
                </div>

                {/* Monthly bar chart — click on a bar to drilldown */}
                <MonthlyBarChart data={monthly} onBarClick={handleBarClick} />

                {/* Billing bar chart — click to drilldown */}
                <BillingBarChart data={billing.monthly} onBarClick={handleBarClick} />

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
                    <DonutChart title="Skills por tipo" data={skillTypeData} colors={SKILL_TYPE_COLORS} />
                  ) : (
                    <div className="card p-5 flex items-center justify-center text-slate-500 text-sm">Sin datos de skills</div>
                  )}

                  {leadStatusData.length > 0 ? (
                    <DonutChart title="Leads por estado" data={leadStatusData} colors={leadStatusColors} />
                  ) : (
                    <div className="card p-5 flex items-center justify-center text-slate-500 text-sm">Sin datos de leads</div>
                  )}

                  {topAgents.length > 0 ? (
                    <TopAgentsChart data={topAgents} />
                  ) : (
                    <div className="card p-5 flex items-center justify-center text-slate-500 text-sm">Sin conversaciones aún</div>
                  )}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* ── ESTUDIOS TAB ──────────────────────────────────────────────── */}
      {activeTab === "estudios" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-slate-500 text-sm">
              Estudios de mercado generados con IA, anclados a datos reales del negocio
            </p>
            <Link
              href="/estadisticas/estudios/nuevo"
              className="btn-primary text-sm px-4 py-2"
            >
              + Nuevo estudio
            </Link>
          </div>

          {studiesLoading && (
            <div className="flex items-center justify-center py-12">
              <span className="text-slate-500 animate-pulse text-sm">Cargando estudios…</span>
            </div>
          )}

          {studiesError && (
            <div className="card p-4 text-red-400 text-sm">{studiesError}</div>
          )}

          {!studiesLoading && !studiesError && studies.length === 0 && (
            <div className="card p-10 text-center">
              <p className="text-slate-500 text-sm mb-3">No hay estudios de mercado todavía</p>
              <Link href="/estadisticas/estudios/nuevo" className="btn-primary text-sm px-4 py-2">
                Crear primer estudio
              </Link>
            </div>
          )}

          {!studiesLoading && studies.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-slate-500 text-xs">
                    <th className="text-left p-3 font-medium">Nombre</th>
                    <th className="text-left p-3 font-medium">Fecha</th>
                    <th className="text-left p-3 font-medium">Éxito</th>
                    <th className="text-left p-3 font-medium">Estado</th>
                    <th className="text-left p-3 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {studies.map((study) => (
                    <tr key={study.id} className="border-b border-white/5 hover:bg-white/2">
                      <td className="p-3 text-white font-medium max-w-[240px] truncate">
                        {study.title}
                      </td>
                      <td className="p-3 text-slate-400 whitespace-nowrap">
                        {new Date(study.createdAt).toLocaleDateString("es-ES", {
                          year: "numeric", month: "short", day: "numeric",
                        })}
                      </td>
                      <td className="p-3">
                        <StarRating value={study.successScore ?? null} />
                      </td>
                      <td className="p-3">
                        <StatusBadge status={study.status} />
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <Link
                            href={`/estadisticas/estudios/${study.id}`}
                            className="btn-ghost text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white"
                          >
                            Abrir
                          </Link>
                          <button
                            onClick={() => handleDeleteStudy(study.id)}
                            className="btn-ghost text-xs px-3 py-1.5 rounded-lg border border-red-500/20 text-red-400 hover:border-red-500/40 hover:text-red-300"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Borrador", cls: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
    generating: { label: "Generando…", cls: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" },
    ready: { label: "Listo", cls: "text-green-400 bg-green-500/10 border-green-500/20" },
    error: { label: "Error", cls: "text-red-400 bg-red-500/10 border-red-500/20" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "text-slate-400 bg-slate-500/10 border-slate-500/20" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      {label}
    </span>
  );
}
