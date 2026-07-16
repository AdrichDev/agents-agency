"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthUser } from "@/hooks/useAuthUser";
import KpiCard from "@/components/stats/KpiCard";
import { AgentsGrid } from "@/components/agents/AgentsGrid";
import { AgendaWidget } from "@/components/dashboard/AgendaWidget";
import { BudgetsWidget } from "@/components/dashboard/BudgetsWidget";
import { InvoicesWidget } from "@/components/dashboard/InvoicesWidget";
import { PendingContactsWidget } from "@/components/dashboard/PendingContactsWidget";

/**
 * Dashboard estilo OperaOS (aa-dashboard-agents-nav-widgets T1.4): KPIs reales
 * (GET /api/stats vía KpiCard), resumen de agentes (AgentsGrid recortado) y
 * widgets de datos (agenda, presupuestos, facturas, contactos). La grid de
 * agentes completa vive ahora en /agents (AgentsGrid).
 */

// Subconjunto de totales que consume el Dashboard (espejo de back/src/lib/stats.ts).
interface StatsTotals {
  agents: number;
  clients: number;
  leads: number;
  conversations: number;
  budgets: number;
}

interface StatsResponse {
  totals: Partial<StatsTotals>;
}

/** Guard: /api/stats puede responder { error } con 200-ish; no confiar la forma. */
function isStatsResponse(data: unknown): data is StatsResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Partial<StatsResponse> & { error?: unknown };
  return !d.error && typeof d.totals === "object" && d.totals !== null;
}

// Nº de agentes en el resumen del Dashboard; la lista completa está en /agents.
const AGENTS_SUMMARY_LIMIT = 6;

export default function Dashboard() {
  const { user } = useAuthUser();
  const [totals, setTotals] = useState<Partial<StatsTotals> | null>(null);

  useEffect(() => {
    api<unknown>("/api/stats")
      .then((data) => setTotals(isStatsResponse(data) ? data.totals : {}))
      .catch(() => setTotals({}));
  }, []);

  const kpis: { label: string; value: number; accent: string }[] = [
    { label: "Agentes", value: totals?.agents ?? 0, accent: "#9d00ff" },
    { label: "Clientes", value: totals?.clients ?? 0, accent: "#0066ff" },
    { label: "Leads", value: totals?.leads ?? 0, accent: "#d946ef" },
    { label: "Conversaciones", value: totals?.conversations ?? 0, accent: "#ff9900" },
    { label: "Presupuestos", value: totals?.budgets ?? 0, accent: "#00f0ff" },
  ];

  return (
    <div>
      <section className="card relative overflow-hidden p-10 mb-10">
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-[var(--neon-purple)]/20 rounded-full blur-[80px]" />
        <div className="absolute -bottom-24 right-40 w-72 h-72 bg-[var(--neon-blue)]/20 rounded-full blur-[80px]" />
        <div className="absolute top-10 left-10 w-40 h-40 bg-[var(--neon-orange)]/10 rounded-full blur-[60px]" />
        <div className="relative">
          <div className="kicker mb-4 text-neon-cyan">Estudio</div>
          <h1 className="text-4xl font-extrabold text-white leading-tight">
            Bienvenido de vuelta{user ? `, ${user.firstName}` : ""}.
          </h1>
          <p className="text-3xl font-light text-slate-400 mb-8">
            Continúa creando con{" "}
            <span className="font-bold text-neon-gradient">IA</span>.
          </p>
          <div className="flex gap-3">
            <Link href="/agents/new" className="btn-grad">
              ✦ Nuevo Agente
            </Link>
            <Link href="/skills" className="btn-dark">
              ◈ Marketplace de skills
            </Link>
          </div>
        </div>
      </section>

      {/* KPIs reales del panel (GET /api/stats vía KpiCard) */}
      {!totals ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-10" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-3 w-16 bg-white/10 rounded mb-3" />
              <div className="h-8 w-12 bg-white/10 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-10">
          {kpis.map((k) => (
            <KpiCard key={k.label} label={k.label} value={k.value} accent={k.accent} />
          ))}
        </div>
      )}

      {/* Resumen de agentes: primeras N tarjetas + acceso a la lista completa */}
      <section className="mb-10">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="kicker !text-slate-300 !text-sm">Tus agentes</h2>
            <p className="text-sm text-slate-500 mt-1">
              Un vistazo rápido a tus asistentes de Inteligencia Artificial.
            </p>
          </div>
          <Link
            href="/agents"
            className="text-sm text-indigo-400 hover:underline whitespace-nowrap"
          >
            Ver todos →
          </Link>
        </div>
        <AgentsGrid limit={AGENTS_SUMMARY_LIMIT} />
      </section>

      {/* Widgets de datos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AgendaWidget limit={5} />
        <BudgetsWidget limit={5} />
        <InvoicesWidget limit={5} />
        <PendingContactsWidget />
      </div>
    </div>
  );
}
