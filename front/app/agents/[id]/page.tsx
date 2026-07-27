"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import ChatTester from "@/components/ChatTester";
import IntegrationsPanel from "@/components/IntegrationsPanel";
import ChannelConnectPanel from "@/components/ChannelConnectPanel";
import AutomationsPanel from "@/components/AutomationsPanel";
import DeployPanel from "@/components/DeployPanel";
import AgentModelPanel from "@/components/AgentModelPanel";
import BusinessDataPanel from "@/components/agents/BusinessDataPanel";
import NotificationConfigPanel from "@/components/agents/NotificationConfigPanel";
import KnowledgeTab from "@/components/agents/KnowledgeTab";
import SkillsTab from "@/components/agents/SkillsTab";
import { AgentStatusChip } from "@/components/agents/AgentStatusChip";
import { useAgentDetail } from "@/hooks/useAgentDetail";

/**
 * Tabs del panel. "Skills" es el editor del conjunto curado de skills del agente
 * (aa-agent-skills-install-execute, F3). "Datos del negocio" es la tab del
 * backend de datos. Sin Logs (historial embebido en Automatizaciones) ni Leads
 * (contador en dashboard).
 */
const TABS = [
  { id: "chat", label: "Probar agente" },
  { id: "datos", label: "Datos del negocio" },
  { id: "canales", label: "Canales e integraciones" },
  { id: "conocimiento", label: "Conocimiento" },
  { id: "skills", label: "Skills" },
  { id: "automatizaciones", label: "Automatizaciones" },
  { id: "implementacion", label: "Implementación" },
  { id: "ajustes", label: "Ajustes" },
] as const;

export default function AgentPage() {
  const {
    agent,
    tab, setTab,
    kbUrl, setKbUrl,
    kbStatus,
    sources,
    fileList, setFileList,
    fileResults,
    fileUploading,
    fileInputRef,
    load,
    deleteSource,
    ingest,
    uploadFiles,
  } = useAgentDetail();

  const [resyncing, setResyncing] = useState(false);

  if (!agent) return <p className="text-slate-500">Cargando…</p>;
  if (agent.error) return <p className="text-red-400">Agente no encontrado (¿backend corriendo en :4000?).</p>;
  const openclawProvisioning = agent.openclawProvisioning ?? agent.ecommerceConfig?.openclawProvisioning;

  // Enlaces antiguos (?tab=logs|leads|integraciones|deploy) → tab válida.
  const activeTab = TABS.some((t) => t.id === tab)
    ? tab
    : tab === "integraciones"
      ? "canales"
      : tab === "deploy"
        ? "implementacion"
        : "chat";

  // Re-sincroniza el agente contra OpenClaw bajo demanda (recheck del back:
  // upsert + sonda /v1/models) y recarga el detalle — el chip deja de ser un
  // snapshot congelado del momento del create.
  async function resyncOpenclaw() {
    if (resyncing) return;
    setResyncing(true);
    try {
      await api(`/api/agents/${agent.id}/openclaw/recheck`, { method: "POST" });
      await load();
    } catch {
      /* fail-soft: se conserva el último estado conocido */
    } finally {
      setResyncing(false);
    }
  }

  return (
    // Alto exacto del viewport (menos topbar h-16 y padding del main py-8) → sin scroll de página;
    // cada pestaña scrollea internamente si su contenido no cabe.
    <div className="flex flex-col h-[calc(100dvh-8rem-2px)] overflow-hidden">
      <div className="kicker mb-2">Agente</div>
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-3xl font-extrabold text-white">{agent.name}</h1>
        {/* H3 (aa-agente-ciclo-vida-publicacion, T5.3): el estado va en la cabecera, no
            dentro de una pestaña. Si atiende al público o no es lo primero que hay que saber
            del agente, y hasta ahora la página no lo decía en ningún sitio. */}
        <AgentStatusChip status={agent.status} />
        <span className="chip-accent">{agent.sector}</span>
        {agent.runtime === "openclaw" && (
          <button
            type="button"
            onClick={() => void resyncOpenclaw()}
            disabled={resyncing}
            className={`rounded-full border px-2.5 py-1 text-xs cursor-pointer transition hover:brightness-125 disabled:opacity-60 ${
              openclawProvisioning?.status === "provisioned"
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                : openclawProvisioning?.status === "failed"
                  ? "border-red-400/40 bg-red-400/10 text-red-300"
                  : "border-amber-400/40 bg-amber-400/10 text-amber-300"
            }`}
            title={`${openclawProvisioning?.reason ?? "Estado del aprovisionamiento en OpenClaw"} — click para re-sincronizar`}
          >
            OpenClaw: {resyncing ? "sincronizando…" : openclawProvisioning?.status ?? "pending"} ⟳
          </button>
        )}
      </div>
      {/* H3/T5.2: el back devuelve `tenant`, no `client` (`service.ts` getAgentDetail), así que
          esta línea nunca se pintó. Mismo bug que había en la tarjeta del listado. */}
      {agent.tenant && <p className="text-sm text-slate-500 mb-5">Cliente: {agent.tenant.name}</p>}

      {/* H3/T5.3: un borrador no atiende al público. El wizard entregaba el agente sin
          decirlo y el operador se enteraba cuando el widget del cliente no respondía. */}
      {agent.status === "draft" && (
        <div className="mb-5 flex items-start justify-between gap-3 flex-wrap rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3">
          <p className="text-xs text-amber-300">
            <strong>En borrador:</strong> el agente todavía no atiende al público. Puedes probarlo
            aquí en «Probar agente»; el widget, la API y las reservas responderán que no está
            publicado hasta que lo publiques.
          </p>
          <button
            type="button"
            onClick={() => setTab("implementacion")}
            className="btn-grad !px-3 !py-1.5 !text-xs shrink-0"
          >
            Ir a publicarlo →
          </button>
        </div>
      )}

      <div className="flex gap-1 border-b border-edge mb-7 overflow-x-auto overflow-y-hidden scrollbar-none">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition ${
              activeTab === t.id
                ? "border-indigo-500 text-white font-medium"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={`flex-1 min-h-0 ${activeTab === "chat" ? "" : "overflow-y-auto pr-1"}`}>
      {activeTab === "chat" && (
        <ChatTester
          agentId={agent.id}
          agentChannel={agent.channel}
          agentModel={agent.model}
          knowledgeSources={sources}
          onGoToKnowledge={() => setTab("conocimiento")}
        />
      )}

      {activeTab === "datos" && (
        <BusinessDataPanel agent={agent} onChange={load} />
      )}

      {activeTab === "canales" && (
        <div className="space-y-8">
          {/* agent.channel es informativo tras la creación: solo distingue canales-bot
              (telegram/whatsapp, que necesitan credenciales de plataforma) del resto.
              "widget" vs "api" no tienen ramas de código distintas en ningún flujo
              posterior a la creación — no asumir que difieren. */}
          {(agent.channel === "telegram" || agent.channel === "whatsapp") && (
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Canales de despliegue</h3>
                <p className="text-xs text-slate-500">Cómo te alcanzan los clientes: la conexión del bot (Telegram/WhatsApp) que recibe sus mensajes.</p>
              </div>
              <ChannelConnectPanel
                agentId={agent.id}
                channel={agent.channel as "telegram" | "whatsapp"}
                onChange={load}
              />
            </section>
          )}
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Integraciones y herramientas</h3>
              <p className="text-xs text-slate-500">Qué puede hacer el agente: conexiones OAuth (Google, Slack, Notion, Jira…) que le dan acceso a herramientas, sin relación con el canal de despliegue.</p>
            </div>
            <IntegrationsPanel
              agentId={agent.id}
              onChange={load}
            />
          </section>
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Notificaciones al propietario</h3>
              <p className="text-xs text-slate-500">Avisos que recibe el dueño del negocio (no el cliente final) sobre la actividad del agente.</p>
            </div>
            <NotificationConfigPanel agent={agent} onChange={load} />
          </section>
        </div>
      )}

      {activeTab === "automatizaciones" && (
        <AutomationsPanel agentId={agent.id} automations={agent.automations} onChange={load} n8nConfigured={agent.n8nConfigured ?? false} />
      )}

      {activeTab === "implementacion" && <DeployPanel agent={agent} onChange={load} />}

      {activeTab === "ajustes" && <AgentModelPanel agent={agent} onChange={load} />}

      {activeTab === "skills" && (
        <SkillsTab
          agent={agent}
          onChange={load}
          onGoToIntegrations={() => setTab("canales")}
        />
      )}

      {activeTab === "conocimiento" && (
        <KnowledgeTab
          agent={agent}
          kbUrl={kbUrl}
          setKbUrl={setKbUrl}
          kbStatus={kbStatus}
          sources={sources}
          fileList={fileList}
          setFileList={setFileList}
          fileResults={fileResults}
          fileUploading={fileUploading}
          fileInputRef={fileInputRef}
          onIngest={ingest}
          onUploadFiles={() => uploadFiles()}
          onDeleteSource={deleteSource}
        />
      )}
      </div>
    </div>
  );
}
