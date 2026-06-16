import type { AgentWizardForm } from "@/components/agent-wizard/types";

export default function ClientStep({
  form,
  set,
}: {
  form: AgentWizardForm;
  set: <K extends keyof AgentWizardForm>(key: K, value: AgentWizardForm[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-white">Paso 1 - ¿Para qué cliente es?</h2>
      <label className="block text-xs text-slate-400">Nombre comercial del cliente</label>
      <input
        className="input-dark"
        placeholder="Nombre comercial (p.ej. Clínica Dental Sonrisa)"
        value={form.clientName}
        onChange={(e) => set("clientName", e.target.value)}
      />
      <p className="text-xs text-slate-500">
        Es el nombre comercial de la empresa, no el de la persona de contacto.
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
