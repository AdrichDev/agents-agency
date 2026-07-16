import type { AgentWizardForm } from "@/components/agent-wizard/types";

export default function ReviewStep({
  form,
  error,
  skillNames = [],
}: {
  form: AgentWizardForm;
  error: string;
  /** Nombres de las skills elegidas (resueltos en el wizard); ids sin resolver caen a su id. */
  skillNames?: string[];
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
        {/* F4: Skills oculto del wizard; se revisa la selección de backend de datos. */}
        <span className="text-slate-500">Datos del negocio:</span>{" "}
        {form.dataBackendMode === "managed_db"
          ? `BD gestionada · ${form.dataBackendCapabilities.join(", ") || "sin capacidades"}`
          : form.dataBackendMode === "none_yet"
            ? "Solo información (FAQ)"
            : "Sin elegir — obligatorio"}
      </p>
      <p>
        <span className="text-slate-500">Skills:</span>{" "}
        {skillNames.length ? skillNames.join(", ") : "ninguna (opcional)"}
      </p>
      <p className="text-slate-400 whitespace-pre-wrap card !rounded-xl p-4 bg-white/5">
        {form.systemPrompt}
      </p>
      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}

