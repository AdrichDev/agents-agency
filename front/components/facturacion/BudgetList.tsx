"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/hooks/usePagination";
import { fmt, type BudgetRecord } from "./types";

interface BudgetListProps {
  budgets: BudgetRecord[];
  loading: boolean;
  clientIdFilter: string | null;
  filteredClientName: string | null;
  onClearClientFilter: () => void;
  onNewBudget: () => void;
  onOpenBudget: (budget: BudgetRecord) => void;
}

export function BudgetList({
  budgets,
  loading,
  clientIdFilter,
  filteredClientName,
  onClearClientFilter,
  onNewBudget,
  onOpenBudget,
}: BudgetListProps) {
  const [search, setSearch] = useState("");

  const filteredBudgets = budgets.filter((b) => {
    if (clientIdFilter && (b.clientId || b.client?.id) !== clientIdFilter) return false;
    const term = search.toLowerCase();
    const cName = (b.clientSnapshot?.name || "").toLowerCase();
    const cContact = (b.clientSnapshot?.contactPerson || "").toLowerCase();
    return cName.includes(term) || cContact.includes(term);
  });

  const { pageItems, page, setPage, totalPages, total } = usePagination(filteredBudgets);

  return (
    <div className="w-full">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="kicker mb-2 text-neon-cyan">Administración</div>
          <h1 className="text-3xl font-extrabold text-neon-gradient">Facturación</h1>
          <p className="text-sm text-slate-500 mt-1">
            Historial de facturas y presupuestos generados.
          </p>
        </div>
        <button onClick={onNewBudget} className="bg-neon-gradient text-white font-bold rounded-xl px-5 py-2.5 flex items-center gap-2 hover:opacity-90 transition shadow-[0_0_15px_rgba(157,0,255,0.4)]">
          <span className="text-lg leading-none">+</span> Nueva factura
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-edge flex items-center justify-between gap-4 flex-wrap">
          <input
            type="text"
            placeholder="Buscar por cliente o contacto..."
            className="input-dark max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {clientIdFilter && (
            <button
              onClick={onClearClientFilter}
              title="Quitar filtro de cliente"
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/40 text-neon-cyan text-xs font-bold hover:bg-cyan-500/20 transition"
            >
              Cliente: {filteredClientName || "..."}
              <span className="text-sm leading-none">&#x2715;</span>
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500">Cargando facturas...</div>
        ) : filteredBudgets.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title="No hay facturas generadas"
            subtitle={'Pulsa en "Nueva factura" para empezar a generar presupuestos.'}
          />
        ) : (
          <Table
            columns={[
              { header: "Nº Presupuesto" },
              { header: "Cliente" },
              { header: "Contacto" },
              { header: "Total", align: "right" },
              { header: "Fecha" },
              { header: "Estado" },
              { header: "" },
            ]}
          >
            {pageItems.map((b) => (
              <tr key={b.id} className="hover:bg-white/[0.02] transition group">
                <td className="px-6 py-4 text-white font-medium">{b.quoteNumber}</td>
                <td className="px-6 py-4 text-slate-300">{b.clientSnapshot.name}</td>
                <td className="px-6 py-4 text-slate-400">{b.clientSnapshot.contactPerson || "—"}</td>
                <td className="px-6 py-4 text-right tabular-nums text-white font-medium">
                  {fmt(b.subtotalImpl)} €
                </td>
                <td className="px-6 py-4 text-slate-400">
                  {new Date(b.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4">
                  <Badge variant={b.status} className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider">
                    {b.status}
                  </Badge>
                </td>
                <td className="px-6 py-4 text-right">
                  <button
                    onClick={() => onOpenBudget(b)}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold text-slate-300 transition"
                  >
                    Ver / Imprimir
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {!loading && filteredBudgets.length > 0 && (
          <div className="px-4 border-t border-edge">
            <Pagination page={page} totalPages={totalPages} onChange={setPage} total={total} />
          </div>
        )}
      </div>
    </div>
  );
}
