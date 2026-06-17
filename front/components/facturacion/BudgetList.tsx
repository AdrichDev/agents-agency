"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { Pencil } from "lucide-react";
import { usePagination } from "@/hooks/usePagination";
import { fmt, type BudgetRecord, type BudgetStatus } from "./types";

type SortKey = "quoteNumber" | "clientName" | "subtotalImpl" | "createdAt" | "status";

// Ciclo de estados al hacer clic (igual que el badge de contactos).
const STATUS_CYCLE: BudgetStatus[] = ["generada", "aceptada", "rechazada", "caducada"];
const nextStatus = (current: string): BudgetStatus => {
  const i = STATUS_CYCLE.indexOf(current as BudgetStatus);
  return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
};

interface BudgetListProps {
  budgets: BudgetRecord[];
  loading: boolean;
  clientIdFilter: string | null;
  filteredClientName: string | null;
  onClearClientFilter: () => void;
  onNewBudget: () => void;
  onOpenBudget: (budget: BudgetRecord) => void;
  onUpdateStatus: (id: string, status: BudgetStatus) => void;
  onEditBudget: (budget: BudgetRecord) => void;
}

export function BudgetList({
  budgets,
  loading,
  clientIdFilter,
  filteredClientName,
  onClearClientFilter,
  onNewBudget,
  onOpenBudget,
  onUpdateStatus,
  onEditBudget,
}: BudgetListProps) {
  const [search, setSearch] = useState("");

  const filteredBudgets = budgets.filter((b) => {
    if (clientIdFilter && (b.clientId || b.client?.id) !== clientIdFilter) return false;
    const term = search.toLowerCase();
    const cName = (b.clientSnapshot?.name || "").toLowerCase();
    const cContact = (b.clientSnapshot?.contactPerson || "").toLowerCase();
    return cName.includes(term) || cContact.includes(term);
  });

  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "createdAt",
    dir: "desc",
  });
  const toggleSort = (key: string) =>
    setSort((s) =>
      s.key === key
        ? { key: s.key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key: key as SortKey, dir: "asc" }
    );
  const dirFor = (k: SortKey) => (sort.key === k ? sort.dir : null);

  const sorted = useMemo(() => {
    const arr = [...filteredBudgets];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      let cmp = 0;
      if (key === "createdAt") {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (key === "subtotalImpl") {
        cmp = (a.subtotalImpl ?? 0) - (b.subtotalImpl ?? 0);
      } else if (key === "clientName") {
        const av = String(a.clientSnapshot?.name ?? "").toLowerCase();
        const bv = String(b.clientSnapshot?.name ?? "").toLowerCase();
        cmp = av.localeCompare(bv, "es");
      } else {
        const av = String((a as unknown as Record<string, unknown>)[key] ?? "").toLowerCase();
        const bv = String((b as unknown as Record<string, unknown>)[key] ?? "").toLowerCase();
        cmp = av.localeCompare(bv, "es");
      }
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filteredBudgets, sort]);

  const { pageItems, page, setPage, totalPages, total } = usePagination(sorted);

  return (
    <div className="w-full">
      <div className="mb-8">
        <div className="kicker mb-2 text-neon-cyan">Administración</div>
        <h1 className="text-3xl font-extrabold text-neon-gradient">Facturación</h1>
        <p className="text-sm text-slate-500 mt-1">
          Historial de facturas y presupuestos generados.
        </p>
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
          <div className="flex items-center gap-3 flex-wrap">
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
            <button onClick={onNewBudget} className="btn-ghost">
              <span className="text-lg leading-none">+</span> Nueva factura
            </button>
          </div>
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
              { header: "Nº Presupuesto", sortKey: "quoteNumber", sortDir: dirFor("quoteNumber"), onSort: toggleSort },
              { header: "Cliente", sortKey: "clientName", sortDir: dirFor("clientName"), onSort: toggleSort },
              { header: "Contacto" },
              { header: "Total", align: "right", sortKey: "subtotalImpl", sortDir: dirFor("subtotalImpl"), onSort: toggleSort },
              { header: "Fecha", sortKey: "createdAt", sortDir: dirFor("createdAt"), onSort: toggleSort },
              { header: "Estado", sortKey: "status", sortDir: dirFor("status"), onSort: toggleSort },
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
                  <button
                    onClick={() => onUpdateStatus(b.id, nextStatus(b.status))}
                    title="Clic para cambiar el estado (generada → aceptada → rechazada → caducada)"
                    className="cursor-pointer hover:opacity-80 transition"
                  >
                    <Badge variant={b.status} className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider">
                      {b.status}
                    </Badge>
                  </button>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-4">
                    {(b.status === "rechazada" || b.status === "generada") && (
                      <button
                        onClick={() => onEditBudget(b)}
                        title="Editar y crear nueva versión"
                        aria-label="Editar"
                        className="icon-btn icon-btn-edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => onOpenBudget(b)}
                      className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold text-slate-300 transition"
                    >
                      Ver / Imprimir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {!loading && totalPages > 1 && (
          <div className="px-4 py-2 border-t border-edge">
            <Pagination page={page} totalPages={totalPages} onChange={setPage} total={total} />
          </div>
        )}
      </div>
    </div>
  );
}
