"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/hooks/useResource";
import type { InvoiceRecord, InvoiceStatus, InvoiceMetrics } from "@/components/facturacion/types";
import { InvoiceList } from "@/components/facturacion/InvoiceList";
import { InvoicePreview } from "@/components/facturacion/InvoicePreview";

const EMPTY_METRICS: InvoiceMetrics = {
  totalCount: 0,
  pendingCount: 0,
  paidCount: 0,
  totalAmount: 0,
  paidAmount: 0,
  pendingAmount: 0,
};

interface InvoicesResponse {
  invoices: InvoiceRecord[];
  metrics: InvoiceMetrics;
}

/**
 * Pantalla `Facturas` (aa-facturas-desde-presupuestos-aceptados): SIN creación
 * manual — las facturas nacen automáticamente cuando un presupuesto pasa a
 * `aceptada` (ver back/src/routes/budgets.ts). Reutiliza la misma base visual
 * que `Facturación` (list/preview), sin la vista "create".
 */
export default function FacturasPage() {
  const [viewState, setViewState] = useState<"list" | "preview">("list");
  const { data, loading, refetch } = useResource<InvoicesResponse>("/api/invoices");
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [metrics, setMetrics] = useState<InvoiceMetrics>(EMPTY_METRICS);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);

  useEffect(() => {
    setInvoices(Array.isArray(data?.invoices) ? data.invoices : []);
    setMetrics(data?.metrics ?? EMPTY_METRICS);
  }, [data]);

  const updateStatus = async (id: string, status: InvoiceStatus) => {
    try {
      await api(`/api/invoices/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      if (selectedInvoice && selectedInvoice.id === id) {
        setSelectedInvoice({ ...selectedInvoice, status });
      }
      await refetch();
    } catch (e) {
      console.error(e);
    }
  };

  if (viewState === "preview" && selectedInvoice) {
    return <InvoicePreview invoice={selectedInvoice} onBack={() => setViewState("list")} />;
  }

  return (
    <InvoiceList
      invoices={invoices}
      metrics={metrics}
      loading={loading}
      onOpenInvoice={(inv) => {
        setSelectedInvoice(inv);
        setViewState("preview");
      }}
      onUpdateStatus={updateStatus}
    />
  );
}
