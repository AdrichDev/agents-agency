"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useResource } from "@/hooks/useResource";
import { useIssuerData } from "@/hooks/useIssuerData";
import {
  SERVICES_CATALOG,
  type BudgetRecord,
  type BudgetStatus,
} from "@/components/presupuestos/types";
import { BudgetList } from "@/components/presupuestos/BudgetList";
import {
  BudgetForm,
  type BudgetDraft,
  type BudgetPayload,
} from "@/components/presupuestos/BudgetForm";
import { BudgetPreview } from "@/components/presupuestos/BudgetPreview";
import { useDialogs } from "@/components/ui/ConfirmProvider";

function emptyDraft(quoteNumber: string): BudgetDraft {
  return {
    linkedClientId: "",
    clientName: "",
    clientRazonSocial: "",
    clientCif: "",
    clientAddress: "",
    clientEmail: "",
    clientPhone: "",
    clientContact: "",
    quoteNumber,
    services: SERVICES_CATALOG.map((s) => ({ ...s, selected: false })),
  };
}

function BillingAndBudgets() {
  const { notify } = useDialogs();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientIdFilter = searchParams.get("clientId");
  const [filteredClientName, setFilteredClientName] = useState<string | null>(
    null,
  );
  const [viewState, setViewState] = useState<"list" | "create" | "preview">(
    "list",
  );

  // Datos remotos
  const {
    data: budgetsData,
    loading,
    refetch,
  } = useResource<BudgetRecord[]>("/api/budgets");
  const { data: clientsData } = useResource<any[]>("/api/clients");
  const [budgets, setBudgets] = useState<BudgetRecord[]>([]);
  const clientsList = Array.isArray(clientsData) ? clientsData : [];

  // Emisor (localStorage)
  const { issuer, saveIssuer } = useIssuerData();

  // Estado de vistas
  const [selectedBudget, setSelectedBudget] = useState<BudgetRecord | null>(
    null,
  );
  const [draft, setDraft] = useState<BudgetDraft>(emptyDraft(""));
  const [saving, setSaving] = useState(false);

  // Sincroniza la copia local mutable (mutaciones optimistas) con el fetch.
  useEffect(() => {
    setBudgets(Array.isArray(budgetsData) ? budgetsData : []);
  }, [budgetsData]);

  // Nombre del cliente filtrado (chip "Cliente: {name}")
  useEffect(() => {
    if (!clientIdFilter) {
      setFilteredClientName(null);
      return;
    }
    let cancelled = false;
    api(`/api/clients/${clientIdFilter}`)
      .then((data) => {
        if (!cancelled) {
          setFilteredClientName(
            data && typeof data.name === "string" ? data.name : null,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setFilteredClientName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clientIdFilter]);

  const clearClientFilter = () => {
    setFilteredClientName(null);
    router.replace("/presupuestos");
  };

  const startNewBudget = () => {
    setDraft(
      emptyDraft(
        `AD-${new Date().getFullYear()}-${String(budgets.length + 1).padStart(3, "0")}`,
      ),
    );
    setViewState("create");
  };

  const handleGenerate = async (
    payload: BudgetPayload,
    _linkedClientId: string,
  ) => {
    setSaving(true);
    try {
      const newBudget = await api<BudgetRecord>("/api/budgets", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await refetch();
      setSelectedBudget(newBudget);
      setViewState("preview");
    } catch (e) {
      console.error(e);
      await notify("Error al guardar presupuesto", { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id: string, status: BudgetStatus) => {
    try {
      await api(`/api/budgets/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      if (selectedBudget && selectedBudget.id === id) {
        setSelectedBudget({ ...selectedBudget, status });
      }
      setBudgets(budgets.map((b) => (b.id === id ? { ...b, status } : b)));
    } catch (e: any) {
      await notify(e.message || "Error al cambiar el estado", { tone: "error" });
    }
  };

  const handleEditRechazada = (budget: BudgetRecord) => {
    setDraft({
      linkedClientId: budget.clientId || "",
      clientName: budget.clientSnapshot.name || "",
      clientRazonSocial: budget.clientSnapshot.razonSocial || "",
      clientCif: budget.clientSnapshot.cif || "",
      clientAddress: budget.clientSnapshot.address || "",
      clientEmail: budget.clientSnapshot.email || "",
      clientPhone: budget.clientSnapshot.phone || "",
      clientContact: budget.clientSnapshot.contactPerson || "",
      quoteNumber: budget.quoteNumber + "-R",
      services: SERVICES_CATALOG.map((s) => {
        const line = budget.lines.find((l) => l.serviceId === s.id);
        return line
          ? { ...s, selected: true, quantity: line.quantity }
          : { ...s, selected: false };
      }),
    });
    setViewState("create");
  };

  if (viewState === "preview" && selectedBudget) {
    return (
      <BudgetPreview
        budget={selectedBudget}
        onBack={() => setViewState("list")}
      />
    );
  }

  if (viewState === "create") {
    return (
      <BudgetForm
        key={draft.quoteNumber}
        draft={draft}
        clientsList={clientsList}
        issuer={issuer}
        saving={saving}
        onSaveIssuer={saveIssuer}
        onCancel={() => setViewState("list")}
        onGenerate={handleGenerate}
      />
    );
  }

  return (
    <BudgetList
      budgets={budgets}
      loading={loading}
      clientIdFilter={clientIdFilter}
      filteredClientName={filteredClientName}
      onClearClientFilter={clearClientFilter}
      onNewBudget={startNewBudget}
      onOpenBudget={(b) => {
        setSelectedBudget(b);
        setViewState("preview");
      }}
      onUpdateStatus={updateStatus}
      onEditBudget={handleEditRechazada}
    />
  );
}

// useSearchParams exige un boundary de Suspense en el prerender estático.
export default function PresupuestosPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-slate-500">
          Cargando presupuestos...
        </div>
      }
    >
      <BillingAndBudgets />
    </Suspense>
  );
}
