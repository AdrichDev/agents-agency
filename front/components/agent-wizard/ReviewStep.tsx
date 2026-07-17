import type { AgentWizardForm } from "@/components/agent-wizard/types";

export default function ReviewStep({
  form,
  error,
}: {
  form: AgentWizardForm;
  error: string;
}) {
  return (
    <div className="space-y-3 text-sm">
      <h2 className="font-semibold text-white">Revisar y crear</h2>
      <p>
        <span className="text-slate-500">Cliente:</span> {form.clientName || "-"}{" "}
        {form.website && `(${form.website})`}
      </p>
      <p>
        <span className="text-slate-500">Sector:</span> {form.sector || "-"}
      </p>
      <p>
        <span className="text-slate-500">Agente:</span> {form.name || "(nombre automatico)"}
      </p>
      <p>
        <span className="text-slate-500">Canal:</span> {form.channel}
      </p>
      <p>
        <span className="text-slate-500">Cerebro:</span>{" "}
        {form.runtime === "openclaw" ? "OpenClaw (local)" : `Cloud · ${form.model}`}
      </p>
      <p>
        {/* Las skills se configuran tras crear el agente (pestaña Skills de la
            ficha); el wizard revisa la selección del backend de datos. */}
        <span className="text-slate-500">Datos del negocio:</span>{" "}
        {form.dataBackendMode === "managed_db"
          ? `BD gestionada · ${form.dataBackendCapabilities.join(", ") || "sin capacidades"}`
          : form.dataBackendMode === "none_yet"
            ? "Solo información (FAQ)"
            : "Sin elegir — obligatorio"}
      </p>
      <p className="text-slate-400 whitespace-pre-wrap card !rounded-xl p-4 bg-white/5">
        {form.systemPrompt}
      </p>
      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}

