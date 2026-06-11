import type { AgentWizardForm } from "@/components/agent-wizard/types";

export default function ReviewStep({ form, error }: { form: AgentWizardForm; error: string }) {
  return (
    <div className="space-y-3 text-sm">
      <h2 className="font-semibold text-white">Paso 6 - Revisar y crear</h2>
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
        <span className="text-slate-500">Skills:</span> {form.skillIds.length}
      </p>
      <p>
        <span className="text-slate-500">Widget:</span> {form.widgetPrimaryColor} /{" "}
        {form.widgetSecondaryColor} / {form.widgetAvatarBase64 ? "imagen" : form.widgetAvatarEmoji}
      </p>
      <p className="text-slate-400 whitespace-pre-wrap card !rounded-xl p-4 bg-white/5">
        {form.systemPrompt}
      </p>
      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}

