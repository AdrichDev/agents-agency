"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/hooks/usePagination";
import { fmt, type InvoiceRecord, type InvoiceStatus, type InvoiceMetrics } from "./types";

type SortKey = "number" | "clientName" | "amount" | "createdAt" | "status";

// Ciclo de estados al hacer clic (igual patrón que BudgetList, con vocabulario propio de factura).
const STATUS_CYCLE: InvoiceStatus[] = ["pendiente", "cobrada"];
const nextStatus = (current: string): InvoiceStatus => {
  const i = STATUS_CYCLE.indexOf(current as InvoiceStatus);
  return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
};

interface InvoiceListProps {
  invoices: InvoiceRecord[];
  metrics: InvoiceMetrics;
  loading: boolean;
  onOpenInvoice: (invoice: InvoiceRecord) => void;
  onUpdateStatus: (id: string, status: InvoiceStatus) => void;
}

/**
 * Pantalla `Facturas` (UC-2, aa-facturas-desde-presupuestos-aceptados): misma
 * base visual que `Facturación` (tabla, buscador, Ver/Imprimir), pero SIN botón
 * de alta manual — las facturas nacen solas al aceptar un presupuesto.
 */
export function InvoiceList({ invoices, metrics, loading, onOpenInvoice, onUpdateStatus }: InvoiceListProps) {
  const [search, setSearch] = useState("");

  const filteredInvoices = invoices.filter((inv) => {
    const term = search.toLowerCase();
    const cName = (inv.budget.clientSnapshot?.name || "").toLowerCase();
    const cContact = (inv.budget.clientSnapshot?.contactPerson || "").toLowerCase();
    const number = inv.number.toLowerCase();
    return cName.includes(term) || cContact.includes(term) || number.includes(term);
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

  const amountOf = (inv: InvoiceRecord) => inv.budget.totalImpl + inv.budget.totalMaint;

  const sorted = useMemo(() => {
    const arr = [...filteredInvoices];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      let cmp = 0;
      if (key === "createdAt") {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (key === "amount") {
        cmp = amountOf(a) - amountOf(b);
      } else if (key === "clientName") {
        const av = String(a.budget.clientSnapshot?.name ?? "").toLowerCase();
        const bv = String(b.budget.clientSnapshot?.name ?? "").toLowerCase();
        cmp = av.localeCompare(bv, "es");
      } else if (key === "number") {
        cmp = a.number.localeCompare(b.number, "es");
      } else {
        cmp = String(a.status).localeCompare(String(b.status), "es");
      }
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filteredInvoices, sort]);

  const { pageItems, page, setPage, totalPages, total } = usePagination(sorted);

  return (
    <div className="w-full">
      <div className="mb-8">
        <div className="kicker mb-2 text-neon-cyan">Administración</div>
        <h1 className="text-3xl font-extrabold text-neon-gradient">Facturas</h1>
        <p className="text-sm text-slate-500 mt-1">
          Se generan automáticamente al aceptar un presupuesto.
        </p>
      </div>

      {/* Métricas (UC-4): calculadas server-side a partir de facturas persistidas. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[
          { label: "Facturas", value: String(metrics.totalCount) },
          { label: "Pendientes de cobro", value: String(metrics.pendingCount) },
          { label: "Importe total", value: `${fmt(metrics.totalAmount)} €` },
          { label: "Importe cobrado", value: `${fmt(metrics.paidAmount)} €` },
          { label: "Importe pendiente de cobro", value: `${fmt(metrics.pendingAmount)} €` },
        ].map((m) => (
          <div key={m.label} className="card p-4">
            <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-1">{m.label}</p>
            <p className="text-xl font-black text-white">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-edge flex items-center justify-between gap-4 flex-wrap">
          <input
            type="text"
            placeholder="Buscar por cliente, contacto o número..."
            className="input-dark max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500">Cargando facturas...</div>
        ) : filteredInvoices.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="Aún no hay facturas"
            subtitle="Las facturas nacen automáticamente cuando un presupuesto pasa a estado «aceptada»."
          />
        ) : (
          <Table
            columns={[
              { header: "Nº Factura", sortKey: "number", sortDir: dirFor("number"), onSort: toggleSort },
              { header: "Cliente", sortKey: "clientName", sortDir: dirFor("clientName"), onSort: toggleSort },
              { header: "Contacto" },
              { header: "Importe", align: "right", sortKey: "amount", sortDir: dirFor("amount"), onSort: toggleSort },
              { header: "Fecha", sortKey: "createdAt", sortDir: dirFor("createdAt"), onSort: toggleSort },
              { header: "Estado", sortKey: "status", sortDir: dirFor("status"), onSort: toggleSort },
              { header: "" },
            ]}
          >
            {pageItems.map((inv) => (
              <tr key={inv.id} className="hover:bg-white/[0.02] transition group">
                <td className="px-6 py-4 text-white font-medium">{inv.number}</td>
                <td className="px-6 py-4 text-slate-300">{inv.budget.clientSnapshot?.name}</td>
                <td className="px-6 py-4 text-slate-400">{inv.budget.clientSnapshot?.contactPerson || "—"}</td>
                <td className="px-6 py-4 text-right tabular-nums text-white font-medium">
                  {fmt(amountOf(inv))} €
                </td>
                <td className="px-6 py-4 text-slate-400">
                  {new Date(inv.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4">
                  <button
                    onClick={() => onUpdateStatus(inv.id, nextStatus(inv.status))}
                    title="Clic para cambiar el estado (pendiente → cobrada)"
                    className="cursor-pointer hover:opacity-80 transition"
                  >
                    <Badge variant={inv.status} className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider">
                      {inv.status}
                    </Badge>
                  </button>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-4">
                    <button
                      onClick={() => onOpenInvoice(inv)}
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
