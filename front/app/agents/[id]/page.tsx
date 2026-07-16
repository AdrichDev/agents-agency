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
import { useAgentDetail } from "@/hooks/useAgentDetail";

/**
 * Tabs del panel (design.md §C, F5): sin Skills (oculta, motor/datos intactos),
 * sin Logs (historial embebido en Automatizaciones) y sin Leads (contador en
 * dashboard). "Datos del negocio" es la tab nueva del backend de datos.
 */
const TABS = [
  { id: "chat", label: "Chat" },
  { id: "datos", label: "Datos del negocio" },
  { id: "canales", label: "Canales e integraciones" },
  { id: "conocimiento", label: "Conocimiento" },
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

  // Enlaces antiguos (?tab=skills|logs|leads|integraciones|deploy) → tab válida.
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
      {agent.client && <p className="text-sm text-slate-500 mb-5">Cliente: {agent.client.name}</p>}

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
      {activeTab === "chat" && <ChatTester agentId={agent.id} />}

      {activeTab === "datos" && (
        <BusinessDataPanel agent={agent} onChange={load} />
      )}

      {activeTab === "canales" && (
        <div className="space-y-6">
          {(agent.channel === "telegram" || agent.channel === "whatsapp") && (
            <ChannelConnectPanel
              agentId={agent.id}
              channel={agent.channel as "telegram" | "whatsapp"}
              onChange={load}
            />
          )}
          <IntegrationsPanel
            agentId={agent.id}
            onChange={load}
          />
          <NotificationConfigPanel agent={agent} onChange={load} />
        </div>
      )}

      {activeTab === "automatizaciones" && (
        <AutomationsPanel agentId={agent.id} automations={agent.automations} onChange={load} n8nConfigured={agent.n8nConfigured ?? false} />
      )}

      {activeTab === "implementacion" && <DeployPanel agent={agent} onChange={load} />}

      {activeTab === "ajustes" && <AgentModelPanel agent={agent} onChange={load} />}

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
