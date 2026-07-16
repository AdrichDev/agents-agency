"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { badgeVariantClass } from "@/components/ui/Badge";
import { fmt, type BudgetRecord } from "@/components/presupuestos/types";

/**
 * Widget de presupuestos recientes del Dashboard (aa-dashboard-agents-nav-widgets
 * T1.4). Consume GET /api/budgets (ordenados desc por createdAt en el back) y
 * muestra los últimos N: nº, cliente, estado y total.
 */

const STATUS_LABELS: Record<string, string> = {
  generada: "Generada",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  caducada: "Caducada",
};

export function BudgetsWidget({ limit = 5 }: { limit?: number }) {
  const [budgets, setBudgets] = useState<BudgetRecord[] | null>(null);

  useEffect(() => {
    api<BudgetRecord[]>("/api/budgets")
      .then((rows) => setBudgets(Array.isArray(rows) ? rows : []))
      .catch(() => setBudgets([]));
  }, []);

  const recent = (budgets ?? []).slice(0, limit);

  return (
    <div className="card p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">Presupuestos recientes</h3>
        <Link href="/presupuestos" className="text-xs text-indigo-400 hover:underline">
          Ver todos →
        </Link>
      </div>

      {!budgets ? (
        <p className="text-sm text-slate-500">Cargando presupuestos...</p>
      ) : recent.length === 0 ? (
        <p className="text-sm text-slate-500">Aún no hay presupuestos.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-edge">
          {recent.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">
                  {b.clientSnapshot?.name || "Sin cliente"}
                </p>
                <p className="text-xs text-slate-500 truncate">{b.quoteNumber}</p>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${badgeVariantClass(
                  (b.status as any) ?? "neutral",
                )}`}
              >
                {STATUS_LABELS[b.status] ?? b.status}
              </span>
              <span className="text-sm font-medium tabular-nums text-white min-w-[74px] text-right">
                {fmt(b.subtotalImpl)} €
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
