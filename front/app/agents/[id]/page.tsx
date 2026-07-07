"use client";

import ChatTester from "@/components/ChatTester";
import IntegrationsPanel from "@/components/IntegrationsPanel";
import ChannelConnectPanel from "@/components/ChannelConnectPanel";
import AutomationsPanel from "@/components/AutomationsPanel";
import DeployPanel from "@/components/DeployPanel";
import LogsPanel from "@/components/LogsPanel";
import LeadsPanel from "@/components/LeadsPanel";
import EcommerceConfigPanel from "@/components/EcommerceConfigPanel";
import AgentModelPanel from "@/components/AgentModelPanel";
import SkillsTab from "@/components/agents/SkillsTab";
import KnowledgeTab from "@/components/agents/KnowledgeTab";
import { useAgentDetail } from "@/hooks/useAgentDetail";

const TABS = ["chat", "skills", "integraciones", "automatizaciones", "deploy", "logs", "conocimiento", "leads", "ajustes"] as const;

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

  if (!agent) return <p className="text-slate-500">Cargando…</p>;
  if (agent.error) return <p className="text-red-400">Agente no encontrado (¿backend corriendo en :4000?).</p>;
  const openclawProvisioning = agent.openclawProvisioning ?? agent.ecommerceConfig?.openclawProvisioning;

  return (
    // Alto exacto del viewport (menos topbar h-16 y padding del main py-8) → sin scroll de página;
    // cada pestaña scrollea internamente si su contenido no cabe.
    <div className="flex flex-col h-[calc(100dvh-8rem-2px)] overflow-hidden">
      <div className="kicker mb-2">Agente</div>
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-3xl font-extrabold text-white">{agent.name}</h1>
        <span className="chip-accent">{agent.sector}</span>
        {agent.runtime === "openclaw" && (
          <span
            className={`rounded-full border px-2.5 py-1 text-xs ${
              openclawProvisioning?.status === "provisioned"
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                : openclawProvisioning?.status === "failed"
                  ? "border-red-400/40 bg-red-400/10 text-red-300"
                  : "border-amber-400/40 bg-amber-400/10 text-amber-300"
            }`}
            title={openclawProvisioning?.reason ?? "OpenClaw provisioning status"}
          >
            OpenClaw: {openclawProvisioning?.status ?? "pending"}
          </span>
        )}
      </div>
      {agent.client && <p className="text-sm text-slate-500 mb-5">Cliente: {agent.client.name}</p>}

      <div className="flex gap-1 border-b border-edge mb-7 overflow-x-auto overflow-y-hidden scrollbar-none">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm capitalize whitespace-nowrap border-b-2 -mb-px transition ${
              tab === t
                ? "border-indigo-500 text-white font-medium"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className={`flex-1 min-h-0 ${tab === "chat" ? "" : "overflow-y-auto pr-1"}`}>
      {tab === "chat" && <ChatTester agentId={agent.id} />}

      {tab === "skills" && (
        <SkillsTab agent={agent} onGoToIntegrations={() => setTab("integraciones")} />
      )}

      {tab === "integraciones" && (
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
          <EcommerceConfigPanel
            agentId={agent.id}
            initial={agent.ecommerceConfig ?? {}}
            onChange={load}
          />
        </div>
      )}

      {tab === "automatizaciones" && (
        <AutomationsPanel agentId={agent.id} automations={agent.automations} onChange={load} n8nConfigured={agent.n8nConfigured ?? false} />
      )}

      {tab === "deploy" && <DeployPanel agent={agent} onChange={load} />}

      {tab === "logs" && <LogsPanel automations={agent.automations} />}

      {tab === "leads" && <LeadsPanel agentId={agent.id} />}

      {tab === "ajustes" && <AgentModelPanel agent={agent} onChange={load} />}

      {tab === "conocimiento" && (
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
