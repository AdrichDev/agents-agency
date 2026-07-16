"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { promptForSector } from "@/lib/promptTemplates";
import { useAgentWizard } from "@/hooks/useAgentWizard";
import { useSectors } from "@/hooks/useSectors";
import ChannelStep from "@/components/agent-wizard/ChannelStep";
import ClientStep from "@/components/agent-wizard/ClientStep";
import DataBackendStep from "@/components/agent-wizard/DataBackendStep";
import PromptStep from "@/components/agent-wizard/PromptStep";
import ReviewStep from "@/components/agent-wizard/ReviewStep";
import SectorStep from "@/components/agent-wizard/SectorStep";
import WizardProgress from "@/components/agent-wizard/WizardProgress";

// Wizard SIMPLIFICADO (aa-openclaw-provision-hardening): de 6 pasos a 4.
// Cliente+Sector van juntos, el canal es solo la elección del canal (la
// apariencia del widget se edita en la ficha del agente). F4
// (aa-agent-backend-foundation): el último paso es "Datos del negocio" +
// revisión — selección OBLIGATORIA del backend de datos (managed_db con
// capacidades o "solo información"), sin default silencioso. Skills queda
// OCULTO del wizard (motor/datos/marketplace intactos). Al crear NO se
// redirige a ciegas: se muestra el progreso real del aprovisionamiento en
// OpenClaw con reintento inline.
const STEPS = ["Cliente y sector", "Canal", "Personalidad", "Datos del negocio"];

interface OpenclawProvisioning {
  status: "provisioned" | "pending" | "failed" | "skipped";
  pendingRestart?: boolean;
  reason?: string;
}

interface CreatedAgent {
  id: string;
  name: string;
  runtime: string;
  provisioning: OpenclawProvisioning | null;
}

/**
 * Panel post-creación: checklist con el estado REAL del agente (BD ✓ →
 * OpenClaw ✓/⏳/✗). Si el aprovisionamiento no está confirmado, reintenta
 * una vez en automático a los pocos segundos y ofrece reintento manual —
 * el recheck del back re-ejecuta el sync y sondea /v1/models.
 */
function PostCreatePanel({ agent, onGoToAgent }: { agent: CreatedAgent; onGoToAgent: () => void }) {
  const [provisioning, setProvisioning] = useState<OpenclawProvisioning | null>(agent.provisioning);
  const [checking, setChecking] = useState(false);

  async function recheck() {
    setChecking(true);
    try {
      const data = await api<{ openclawProvisioning: OpenclawProvisioning }>(
        `/api/agents/${agent.id}/openclaw/recheck`,
        { method: "POST" }
      );
      if (data.openclawProvisioning) setProvisioning(data.openclawProvisioning);
    } catch {
      /* fail-soft: se conserva el último estado conocido */
    } finally {
      setChecking(false);
    }
  }

  // Reintento automático único: los patches suelen tardar unos segundos en
  // quedar servidos tras un restart del gateway.
  useEffect(() => {
    if (provisioning?.status === "provisioned") return;
    const t = setTimeout(() => void recheck(), 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = provisioning?.status ?? "pending";
  const ok = status === "provisioned";
  const failed = status === "failed";

  return (
    <div className="card p-7 space-y-5">
      <h2 className="font-semibold text-white text-lg">🎉 Agente «{agent.name}» creado</h2>

      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-emerald-400">✓</span>
          <span className="text-slate-300">Guardado en la plataforma</span>
        </div>
        <div className="flex items-start gap-3">
          <span className={ok ? "text-emerald-400" : failed ? "text-red-400" : "text-amber-400"}>
            {ok ? "✓" : failed ? "✗" : checking ? "…" : "⏳"}
          </span>
          <div>
            <span className="text-slate-300">
              Cerebro OpenClaw:{" "}
              {ok
                ? "aprovisionado y en servicio"
                : failed
                  ? "no se pudo aprovisionar"
                  : checking
                    ? "comprobando…"
                    : "aprovisionado, esperando al gateway"}
            </span>
            {!ok && provisioning?.reason && (
              <p className="text-xs text-slate-500 mt-0.5">{provisioning.reason}</p>
            )}
            {!ok && (
              <p className="text-xs text-slate-500 mt-0.5">
                Tranquilo: la plataforma re-sincroniza sola cada pocos minutos. Puedes seguir
                configurando el agente mientras tanto.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        {!ok && (
          <button onClick={() => void recheck()} disabled={checking} className="btn-dark text-sm">
            {checking ? "Comprobando..." : "Reintentar sincronización"}
          </button>
        )}
        <button onClick={onGoToAgent} className="btn-grad">
          Ir al agente →
        </button>
      </div>
    </div>
  );
}

export default function NewAgentWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Si venimos del landing builder, al terminar volvemos allí con el id del agente
  // para auto-incluir su webbot (en vez de ir a la página del agente).
  const returnTo = searchParams.get("returnTo");
  const { form, set, clearDraft } = useAgentWizard();
  const sectors = useSectors();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [improving, setImproving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedAgent | null>(null);

  // Validación por paso: qué falta para poder continuar (null = se puede).
  function blockedReason(): string | null {
    if (step === 1) {
      if (!form.sector) return "Elige un sector";
      if (form.clientMode === "new" && !form.clientName.trim()) return "Escribe el nombre del cliente nuevo";
    }
    if (step === 3 && !form.systemPrompt.trim()) return "El agente necesita una personalidad (prompt)";
    // F4: selección obligatoria del backend de datos — sin default silencioso.
    if (step === 4) {
      if (!form.dataBackendMode) {
        return "Elige cómo gestiona los datos del negocio (o «Solo información»)";
      }
      if (form.dataBackendMode === "managed_db" && form.dataBackendCapabilities.length === 0) {
        return "Elige al menos una capacidad: reservas, leads o pedidos";
      }
    }
    return null;
  }

  function next() {
    // Al entrar en Personalidad (paso 3), autogenerar el prompt por sector si está vacío.
    if (step === 2 && !form.systemPrompt) {
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
    // Guard defensivo: el botón ya se deshabilita, pero nunca crear sin
    // selección válida de backend de datos (F4).
    if (blockedReason()) return;
    setSaving(true);
    setError("");
    try {
      const agent = await api<any>("/api/agents", {
        method: "POST",
        body: JSON.stringify({
          name: form.name || `Agente ${form.clientName || form.sector}`,
          sector: form.sector || "Otro",
          systemPrompt: form.systemPrompt || promptForSector(form.sector, form.clientName),
          model: form.model,
          runtime: form.runtime,
          reasoningEffort: form.reasoningEffort,
          temperature: form.temperature,
          channel: form.channel,
          tenantId: form.clientMode === "existing" ? form.tenantId || undefined : undefined,
          clientName: form.clientName || undefined,
          website: form.website || undefined,
          // F4: Skills oculto del wizard — no se envían skillIds (el back
          // defaultea []). El backend de datos es obligatorio.
          dataBackend:
            form.dataBackendMode === "managed_db"
              ? { mode: "managed_db", capabilities: form.dataBackendCapabilities }
              : { mode: "none_yet" },
          widgetPrimaryColor: form.widgetPrimaryColor,
          widgetSecondaryColor: form.widgetSecondaryColor,
          widgetAvatarBase64: form.widgetAvatarBase64 || undefined,
          widgetAvatarEmoji: form.widgetAvatarEmoji,
          widgetTemplateConfig: form.widgetTemplateConfig,
        }),
      });
      if (agent.id) {
        clearDraft();
        if (returnTo) {
          const sep = returnTo.includes("?") ? "&" : "?";
          router.push(`${returnTo}${sep}newAgentId=${agent.id}`);
          return;
        }
        if (agent.runtime === "openclaw") {
          // No asumir éxito: mostrar el progreso real del aprovisionamiento.
          setCreated({
            id: agent.id,
            name: agent.name,
            runtime: agent.runtime,
            provisioning: agent.openclawProvisioning ?? agent.ecommerceConfig?.openclawProvisioning ?? null,
          });
          setSaving(false);
          return;
        }
        router.push(`/agents/${agent.id}?tab=integraciones&nuevo=1`);
      } else {
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

  if (created) {
    return (
      <div className="max-w-4xl w-full">
        <div className="kicker mb-2">Wizard</div>
        <h1 className="text-3xl font-extrabold text-white mb-8">Nuevo agente</h1>
        <PostCreatePanel
          agent={created}
          onGoToAgent={() => router.push(`/agents/${created.id}?tab=integraciones&nuevo=1`)}
        />
      </div>
    );
  }

  const blocked = blockedReason();

  return (
    <div className="max-w-4xl w-full">
      <div className="kicker mb-2">Wizard</div>
      <h1 className="text-3xl font-extrabold text-white mb-8">Nuevo agente</h1>

      <WizardProgress steps={STEPS} step={step} />

      <div className="card p-7 min-h-[340px] space-y-8">
        {step === 1 && (
          <>
            <ClientStep form={form} set={set} />
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
          </>
        )}
        {step === 2 && <ChannelStep form={form} set={set} />}
        {step === 3 && (
          <PromptStep form={form} set={set} improving={improving} onImprove={improvePrompt} />
        )}
        {step === 4 && (
          <>
            <DataBackendStep form={form} set={set} />
            <ReviewStep form={form} error={error} />
          </>
        )}
      </div>

      <div className="flex justify-between items-center mt-5">
        <button
          onClick={() => setStep((current) => Math.max(1, current - 1))}
          disabled={step === 1}
          className="px-4 py-2 text-sm text-slate-500 hover:text-slate-300 disabled:opacity-30"
        >
          Atrás
        </button>
        <div className="flex items-center gap-3">
          {blocked && <span className="text-xs text-slate-500">{blocked}</span>}
          {step < STEPS.length ? (
            <button onClick={next} disabled={Boolean(blocked)} className="btn-grad">
              Siguiente
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={saving || Boolean(blocked) || !form.systemPrompt}
              className="btn-grad"
            >
              {saving ? "Creando..." : "Crear agente"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
