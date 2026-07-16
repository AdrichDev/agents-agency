"use client";

import { useState } from "react";
import { useAutomations } from "@/hooks/useAutomations";
import { EMPTY_FORM, type Automation } from "@/components/automations/automationCatalog";
import AutomationItem from "@/components/automations/AutomationItem";
import AutomationForm from "@/components/automations/AutomationForm";
import AutomationImportForm from "@/components/automations/AutomationImportForm";
import LogsPanel from "@/components/LogsPanel";

export default function AutomationsPanel({
  agentId,
  automations,
  onChange,
  n8nConfigured = false,
}: {
  agentId: string;
  automations: Automation[];
  onChange: () => void;
  /** R6-4: si el backend tiene N8N_BASE_URL configurado */
  n8nConfigured?: boolean;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [showImport, setShowImport] = useState(false);
  const {
    showForm, setShowForm,
    saving,
    serviceToProvider,
    getServiceConnectionState,
    create,
    toggle,
    remove,
    resync,
  } = useAutomations(agentId, onChange);

  async function handleCreate() {
    await create(form);
    setForm(EMPTY_FORM);
  }

  return (
    <div className="space-y-4">
      {/* R6-4: aviso si n8n no está configurado */}
      {!n8nConfigured && (
        <div className="rounded-xl border border-slate-700 bg-white/5 px-4 py-3 text-xs text-slate-400">
          n8n no configurado — las automatizaciones usan el motor interno
        </div>
      )}

      {automations.map((a) => (
        <AutomationItem
          key={a.id}
          a={a}
          onToggle={toggle}
          onRemove={remove}
          onResync={resync}
        />
      ))}

      {/* F5 (AC8): import de workflow n8n = camino principal; el builder NL
          queda como azúcar secundaria. */}
      {showImport ? (
        <AutomationImportForm
          agentId={agentId}
          n8nConfigured={n8nConfigured}
          onImported={() => {
            setShowImport(false);
            onChange();
          }}
          onCancel={() => setShowImport(false)}
        />
      ) : showForm ? (
        <AutomationForm
          agentId={agentId}
          form={form}
          setForm={setForm}
          saving={saving}
          n8nConfigured={n8nConfigured}
          serviceToProvider={serviceToProvider}
          getServiceConnectionState={getServiceConnectionState}
          onCreate={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <div className="space-y-2">
          <button
            onClick={() => setShowImport(true)}
            className="w-full border-2 border-dashed border-indigo-500/30 rounded-2xl py-5 text-sm text-indigo-300 hover:border-indigo-500/60 hover:text-indigo-200 transition"
          >
            ⇪ Importar workflow n8n — pega el JSON o elige uno de la instancia
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="w-full border-2 border-dashed border-white/10 rounded-2xl py-4 text-xs text-slate-500 hover:border-indigo-500/40 hover:text-indigo-300 transition"
          >
            + Automatización en lenguaje natural (avanzado)
          </button>
        </div>
      )}

      {/* Historial de ejecuciones embebido (F5: absorbe la antigua tab Logs). */}
      <div className="border-t border-edge pt-4">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
          Historial de ejecuciones
        </h4>
        <LogsPanel automations={automations as any} />
      </div>
    </div>
  );
}
