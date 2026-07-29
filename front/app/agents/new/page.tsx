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

// Wizard (aa-openclaw-provision-hardening + aa-wizard-canal-aware-limpieza H3):
// Cliente+Sector van juntos, el canal es solo la elección del canal (la
// apariencia del widget se edita en la ficha del agente). "Datos del negocio"
// exige selección OBLIGATORIA del backend de datos (managed_db con capacidades o
// "solo información"), sin default silencioso, y es el último paso: cierra con la
// revisión final. Las skills ya NO se eligen en el wizard: se configuran después
// de crear el agente (pestaña Skills de la ficha), para no duplicar. Al crear NO
// se redirige a ciegas: se muestra el progreso real del aprovisionamiento en
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
  /** aa-puesta-en-marcha-agente (T3.1): si se pulsó «Crear y publicar» y salió bien. */
  published: boolean;
  /** Mensaje del back si la publicación falló. El agente EXISTE, en borrador. */
  publishError: string | null;
}

/**
 * Panel post-creación: checklist con el estado REAL del agente (BD ✓ →
 * OpenClaw ✓/⏳/✗). Si el aprovisionamiento no está confirmado, reintenta
 * una vez en automático a los pocos segundos y ofrece reintento manual —
 * el recheck del back re-ejecuta el sync y sondea /v1/models.
 */
function PostCreatePanel({
  agent,
  onGoToAgent,
  onGoToImplementation,
}: {
  agent: CreatedAgent;
  onGoToAgent: () => void;
  /** Pestaña de implementación: es donde se publica y donde está el snippet del widget. */
  onGoToImplementation: () => void;
}) {
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

      {/* H3 (aa-agente-ciclo-vida-publicacion, T5.3) — Creado ≠ publicado.
          Hasta ese change el alta generaba la `publicKey` y el agente atendía al público en
          ese mismo instante, sin que nadie lo decidiera y facturando. Desde entonces nace en
          borrador, y eso hay que decirlo aquí: si no, el operador entrega el snippet al cliente
          y persigue un fallo que no existe.

          aa-puesta-en-marcha-agente (T3.2) — Ahora el wizard SÍ puede publicar, así que el
          aviso deja de ser incondicional: si se pulsó «Crear y publicar» y salió bien, lo que
          falta ya no es publicar, es instalar el widget. Un aviso que miente se ignora. */}
      {agent.published ? (
        <div className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-3">
          <p className="text-xs text-emerald-300">
            <strong>Publicado.</strong> Ya cuenta como agente activo en la facturación del
            cliente, pero todavía no atiende a nadie: hasta que el widget esté instalado en su
            web (o haya un canal conectado) no hay por dónde escribirle.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3">
          <p className="text-xs text-amber-300">
            <strong>Aún no está publicado.</strong> Queda en borrador: puedes probarlo desde su
            consola, pero el widget, la API y las reservas responderán que no está publicado
            hasta que lo publiques. Publicarlo es lo que lo pone a atender al público y lo que
            lo cuenta como agente activo en la facturación del cliente.
          </p>
          {agent.publishError && (
            <p className="text-xs text-amber-200/80 mt-2">
              Se intentó publicar y no salió: {agent.publishError} El agente está creado y no se
              ha perdido nada — puedes publicarlo desde su ficha.
            </p>
          )}
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        {!ok && (
          <button onClick={() => void recheck()} disabled={checking} className="btn-dark text-sm">
            {checking ? "Comprobando..." : "Reintentar sincronización"}
          </button>
        )}
        <button onClick={onGoToAgent} className="btn-dark text-sm">
          Ir al agente →
        </button>
        <button onClick={onGoToImplementation} className="btn-grad">
          {agent.published ? "Instalar el widget →" : "Publicarlo →"}
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

  /**
   * aa-puesta-en-marcha-agente (T3.3) — qué impide publicar desde el wizard.
   *
   * Refleja las MISMAS dos precondiciones del back (`checkPublishPreconditions`):
   * cliente al que cobrar y prompt. Si el cliente es nuevo, el back crea el
   * tenant al vuelo, así que basta con que haya nombre.
   */
  function publishBlockedReason(): string | null {
    const hasClient =
      form.clientMode === "existing" ? Boolean(form.tenantId) : Boolean(form.clientName.trim());
    if (!hasClient) return "Sin cliente asignado no se puede publicar: no habría a quién facturarlo.";
    if (!form.systemPrompt.trim()) return "Sin personalidad (prompt) no se puede publicar.";
    return null;
  }

  /**
   * aa-puesta-en-marcha-agente (T3.1) — el remate del wizard.
   *
   * Hasta este change el wizard terminaba SIEMPRE en un borrador y en producción
   * eso dejó 10 de 11 agentes sin publicar, ninguno bloqueado por nada: el único
   * evento de transición de estado de toda la historia lo generamos nosotros.
   *
   * Publicar es `POST /api/agents/:id/publish`, la misma ruta de siempre. No se
   * añade un `publish: true` al alta ni un segundo sitio que mueva el estado:
   * `transitionAgentStatus` es quien escribe el `AgentStatusEvent` y la
   * auditoría de facturación tiene que seguir teniendo un solo origen.
   */
  async function submit(publish: boolean) {
    // Guard defensivo: el botón ya se deshabilita, pero nunca crear sin
    // selección válida de backend de datos (F4).
    if (blockedReason()) return;
    if (publish && publishBlockedReason()) return;
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
          // Las skills se configuran DESPUÉS de crear el agente (pestaña Skills
          // de la ficha), no en el wizard. Se crea siempre con 0 skills; el back
          // acepta el campo opcional (default []).
          skillIds: [],
          // El backend de datos sigue siendo obligatorio.
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

        // Fallo parcial (T3.2): si el alta va bien y la publicación falla, el
        // agente EXISTE en borrador. No se borra ni se reintenta en bucle —
        // perder el trabajo del wizard por un fallo de red sería peor que
        // dejarlo en borrador. Se navega igual y se enseña el error.
        let published = false;
        let publishError: string | null = null;
        if (publish) {
          try {
            const res = await api<any>(`/api/agents/${agent.id}/publish`, { method: "POST" });
            if (res?.error) {
              publishError =
                typeof res.error === "string" ? res.error : "No se pudo publicar el agente.";
            } else {
              published = true;
            }
          } catch {
            publishError = "No se pudo publicar el agente. Sigue en borrador.";
          }
        }

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
            published,
            publishError,
          });
          setSaving(false);
          return;
        }
        // H3/T5.3: sin `nuevo=1`. Nadie leía ese flag (era el único intento de decir "esto
        // acaba de nacer"); ahora lo dice el aviso de borrador de la propia página del agente.
        //
        // aa-puesta-en-marcha-agente: si se publicó, el siguiente paso ya no es
        // elegir canal sino ponerlo donde lo vea alguien → Implementación.
        router.push(`/agents/${agent.id}?tab=${published ? "implementacion" : "integraciones"}`);
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
          onGoToAgent={() => router.push(`/agents/${created.id}?tab=integraciones`)}
          // H3/T5.3: la pestaña de Implementación es donde vive la banda de publicación,
          // y también el snippet del widget — el paso siguiente si ya está publicado.
          onGoToImplementation={() => router.push(`/agents/${created.id}?tab=implementacion`)}
        />
      </div>
    );
  }

  const blocked = blockedReason();
  const publishBlocked = publishBlockedReason();

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

      <div className="flex justify-between items-start mt-5 gap-4">
        <button
          onClick={() => setStep((current) => Math.max(1, current - 1))}
          disabled={step === 1}
          className="px-4 py-2 text-sm text-slate-500 hover:text-slate-300 disabled:opacity-30 shrink-0"
        >
          Atrás
        </button>
        {step < STEPS.length ? (
          <div className="flex items-center gap-3">
            {blocked && <span className="text-xs text-slate-500">{blocked}</span>}
            <button onClick={next} disabled={Boolean(blocked)} className="btn-grad">
              Siguiente
            </button>
          </div>
        ) : (
          /* aa-puesta-en-marcha-agente (T3.1/T3.4) — Dos acciones explícitas.
             Publicar es lo que pone el agente a atender Y lo que lo mete en la
             factura del cliente: no puede pasar por una sola acción ambigua ni,
             como hasta ahora, quedar escondido detrás de un aviso que en siete
             semanas no pulsó nadie. */
          <div className="text-right space-y-3">
            {blocked && <p className="text-xs text-slate-500">{blocked}</p>}
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => void submit(false)}
                disabled={saving || Boolean(blocked) || !form.systemPrompt}
                className="btn-dark text-sm"
              >
                {saving ? "Creando..." : "Crear como borrador"}
              </button>
              <button
                onClick={() => void submit(true)}
                disabled={
                  saving || Boolean(blocked) || !form.systemPrompt || Boolean(publishBlocked)
                }
                className="btn-grad"
                title={publishBlocked ?? undefined}
              >
                {saving ? "Creando..." : "Crear y publicar"}
              </button>
            </div>
            <p className="text-xs text-slate-500 max-w-md ml-auto">
              {publishBlocked ? (
                <span className="text-amber-300">{publishBlocked}</span>
              ) : (
                <>
                  <strong className="text-slate-400">Publicar</strong> lo pone a atender al público
                  y lo cuenta como agente activo en la facturación del cliente.{" "}
                  <strong className="text-slate-400">Borrador</strong> no atiende a nadie: sólo
                  puedes probarlo desde su consola.
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
