import { useEffect, useMemo, useState } from "react";
import type { AgentWizardForm } from "@/components/agent-wizard/types";
import { api } from "@/lib/api";

interface ClientOption {
  id: string;
  name: string;
  sector?: string | null;
  website?: string | null;
}

export default function ClientStep({
  form,
  set,
}: {
  form: AgentWizardForm;
  set: <K extends keyof AgentWizardForm>(key: K, value: AgentWizardForm[K]) => void;
}) {
  const [clients, setClients] = useState<ClientOption[]>([]);

  useEffect(() => {
    api<ClientOption[]>("/api/clients")
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .catch(() => setClients([]));
  }, []);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === form.tenantId),
    [clients, form.tenantId],
  );

  function selectClient(value: string) {
    if (value === "__new__") {
      set("clientMode", "new");
      set("tenantId", "");
      set("clientName", "");
      set("website", "");
      return;
    }

    const client = clients.find((item) => item.id === value);
    if (!client) return;
    set("clientMode", "existing");
    set("tenantId", client.id);
    set("clientName", client.name);
    set("website", client.website ?? "");
    if (client.sector) set("sector", client.sector);
  }

  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-white">¿Para qué cliente es?</h2>
      <label htmlFor="agent-client-select" className="block text-xs text-slate-400">
        Nombre comercial del cliente
      </label>
      <select
        id="agent-client-select"
        className="input-dark"
        value={form.clientMode === "existing" ? form.tenantId : "__new__"}
        onChange={(e) => selectClient(e.target.value)}
      >
        <option value="">Selecciona un cliente existente</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
        <option value="__new__">Nuevo cliente</option>
      </select>
      {form.clientMode === "new" && (
        <input
          className="input-dark"
          placeholder="Nombre comercial (p.ej. Clínica Dental Sonrisa)"
          value={form.clientName}
          onChange={(e) => set("clientName", e.target.value)}
        />
      )}
      <p className="text-xs text-slate-500">
        {selectedClient
          ? "El agente se vinculará al tenant existente, sin crear un cliente duplicado."
          : "Es el nombre comercial de la empresa, no el de la persona de contacto."}
      </p>
      <input
        className="input-dark"
        placeholder="Web del cliente - https://..."
        value={form.website}
        onChange={(e) => set("website", e.target.value)}
      />
      <p className="text-xs text-slate-500">
        Si indicas la web, el agente se alimenta automáticamente de su contenido.
      </p>
    </div>
  );
}
