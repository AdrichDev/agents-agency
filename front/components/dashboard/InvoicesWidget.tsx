"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  fmt,
  type InvoiceRecord,
  type InvoiceMetrics,
} from "@/components/presupuestos/types";

/**
 * Widget de facturas pendientes del Dashboard (aa-dashboard-agents-nav-widgets
 * T1.4). Consume GET /api/invoices → { invoices, metrics }; las métricas ya
 * vienen calculadas server-side con computeInvoiceMetrics (back/src/lib/invoices).
 * Nota: el modelo no tiene vencimiento, así que "pendiente de cobro" es el
 * único estado de impago disponible (no hay "vencida" en los datos).
 */

interface InvoicesResponse {
  invoices: InvoiceRecord[];
  metrics: InvoiceMetrics;
}

const EMPTY_METRICS: InvoiceMetrics = {
  totalCount: 0,
  pendingCount: 0,
  paidCount: 0,
  totalAmount: 0,
  paidAmount: 0,
  pendingAmount: 0,
};

export function InvoicesWidget({ limit = 5 }: { limit?: number }) {
  const [data, setData] = useState<InvoicesResponse | null>(null);

  useEffect(() => {
    api<InvoicesResponse>("/api/invoices")
      .then((res) =>
        setData({
          invoices: Array.isArray(res?.invoices) ? res.invoices : [],
          metrics: res?.metrics ?? EMPTY_METRICS,
        }),
      )
      .catch(() => setData({ invoices: [], metrics: EMPTY_METRICS }));
  }, []);

  const metrics = data?.metrics ?? EMPTY_METRICS;
  const pending = (data?.invoices ?? [])
    .filter((inv) => inv.status === "pendiente")
    .slice(0, limit);

  return (
    <div className="card p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">Facturas pendientes</h3>
        <Link href="/facturas" className="text-xs text-indigo-400 hover:underline">
          Ver facturas →
        </Link>
      </div>

      {!data ? (
        <p className="text-sm text-slate-500">Cargando facturas...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-1">
                Pendientes de cobro
              </p>
              <p className="text-2xl font-black text-amber-400">
                {metrics.pendingCount}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-1">
                Importe pendiente
              </p>
              <p className="text-2xl font-black text-white tabular-nums">
                {fmt(metrics.pendingAmount)} €
              </p>
            </div>
          </div>

          {pending.length === 0 ? (
            <p className="text-sm text-slate-500">Sin facturas pendientes de cobro.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-edge">
              {pending.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">
                      {inv.budget?.clientSnapshot?.name || "Sin cliente"}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{inv.number}</p>
                  </div>
                  <span className="text-sm font-medium tabular-nums text-white min-w-[74px] text-right">
                    {fmt((inv.budget?.totalImpl ?? 0) + (inv.budget?.totalMaint ?? 0))} €
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
