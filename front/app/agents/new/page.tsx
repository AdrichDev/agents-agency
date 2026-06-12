"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { promptForSector } from "@/lib/promptTemplates";
import { useAgentWizard } from "@/hooks/useAgentWizard";
import { useSectors } from "@/hooks/useSectors";
import { useWizardSkills } from "@/hooks/useWizardSkills";
import ChannelStep from "@/components/agent-wizard/ChannelStep";
import ClientStep from "@/components/agent-wizard/ClientStep";
import PromptStep from "@/components/agent-wizard/PromptStep";
import ReviewStep from "@/components/agent-wizard/ReviewStep";
import SectorStep from "@/components/agent-wizard/SectorStep";
import SkillsStep from "@/components/agent-wizard/SkillsStep";
import WizardProgress from "@/components/agent-wizard/WizardProgress";

const STEPS = ["Cliente", "Sector", "Canal", "Personalidad", "Skills", "Revisar"];

export default function NewAgentWizard() {
  const router = useRouter();
  const { form, set } = useAgentWizard();
  const sectors = useSectors();
  const wizardSkills = useWizardSkills();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [improving, setImproving] = useState(false);
  const [error, setError] = useState("");

  function next() {
    if (step === 3 && !form.systemPrompt) {
      set("systemPrompt", promptForSector(form.sector, form.clientName));
    }
    setStep((current) => Math.min(STEPS.length, current + 1));
  }

  async function improvePrompt() {
    setImproving(true);
    try {
      const data = await api<any>("/api/prompt/improve", {
        method: "POST",
        body: JSON.stringify({
          sector: form.sector,
          prompt: form.systemPrompt || promptForSector(form.sector, form.clientName),
          clientName: form.clientName,
          website: form.website,
        }),
      });
      if (data.prompt) set("systemPrompt", data.prompt);
    } catch {
      if (!form.systemPrompt) set("systemPrompt", promptForSector(form.sector, form.clientName));
    } finally {
      setImproving(false);
    }
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const agent = await api<any>("/api/agents", {
        method: "POST",
        body: JSON.stringify({
          name: form.name || `Agente ${form.clientName || form.sector}`,
          sector: form.sector || "Otro",
          systemPrompt: form.systemPrompt || promptForSector(form.sector, form.clientName),
          temperature: form.temperature,
          channel: form.channel,
          clientName: form.clientName || undefined,
          website: form.website || undefined,
          skillIds: form.skillIds,
          widgetPrimaryColor: form.widgetPrimaryColor,
          widgetSecondaryColor: form.widgetSecondaryColor,
          widgetAvatarBase64: form.widgetAvatarBase64 || undefined,
          widgetAvatarEmoji: form.widgetAvatarEmoji,
          widgetTemplateConfig: form.widgetTemplateConfig,
        }),
      });
      if (agent.id) router.push(`/agents/${agent.id}?tab=integraciones&nuevo=1`);
      else {
        const fieldErrors = agent.error?.fieldErrors;
        setError(
          typeof agent.error === "string"
            ? agent.error
            : fieldErrors && Object.keys(fieldErrors).length
              ? Object.entries(fieldErrors)
                  .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(", ")}`)
                  .join(" · ")
              : "Revisa los campos"
        );
        setSaving(false);
      }
    } catch {
      setError("No se pudo conectar con el backend (:4000)");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl w-full">
      <div className="kicker mb-2">Wizard</div>
      <h1 className="text-3xl font-extrabold text-white mb-8">Nuevo agente</h1>

      <WizardProgress steps={STEPS} step={step} />

      <div className="card p-7 min-h-[340px]">
        {step === 1 && <ClientStep form={form} set={set} />}
        {step === 2 && (
          <SectorStep
            form={form}
            set={set}
            sectors={sectors.items}
            sectorPage={sectors.page}
            totalPages={sectors.totalPages}
            onPage={sectors.setPage}
            onAddSector={sectors.addSector}
            adding={sectors.adding}
            status={sectors.status}
          />
        )}
        {step === 3 && <ChannelStep form={form} set={set} />}
        {step === 4 && (
          <PromptStep form={form} set={set} improving={improving} onImprove={improvePrompt} />
        )}
        {step === 5 && (
          <SkillsStep
            form={form}
            set={set}
            skills={wizardSkills.items}
            uses={wizardSkills.uses}
            q={wizardSkills.q}
            setQ={wizardSkills.setQ}
            use={wizardSkills.use}
            setUse={wizardSkills.setUse}
            page={wizardSkills.page}
            setPage={wizardSkills.setPage}
            totalPages={wizardSkills.totalPages}
          />
        )}
        {step === 6 && <ReviewStep form={form} error={error} />}
      </div>

      <div className="flex justify-between mt-5">
        <button
          onClick={() => setStep((current) => Math.max(1, current - 1))}
          disabled={step === 1}
          className="px-4 py-2 text-sm text-slate-500 hover:text-slate-300 disabled:opacity-30"
        >
          Atrás
        </button>
        {step < STEPS.length ? (
          <button onClick={next} disabled={step === 2 && !form.sector} className="btn-grad">
            Siguiente
          </button>
        ) : (
          <button onClick={submit} disabled={saving || !form.systemPrompt} className="btn-grad">
            {saving ? "Creando..." : "Crear agente"}
          </button>
        )}
      </div>
    </div>
  );
}
