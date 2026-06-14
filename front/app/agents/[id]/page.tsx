"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import ChatTester from "@/components/ChatTester";
import IntegrationsPanel from "@/components/IntegrationsPanel";
import ChannelConnectPanel from "@/components/ChannelConnectPanel";
import AutomationsPanel from "@/components/AutomationsPanel";
import DeployPanel from "@/components/DeployPanel";
import LogsPanel from "@/components/LogsPanel";
import LeadsPanel from "@/components/LeadsPanel";
import EcommerceConfigPanel from "@/components/EcommerceConfigPanel";
import { useDialogs } from "@/components/ui/ConfirmProvider";

const TABS = ["chat", "skills", "integraciones", "automatizaciones", "deploy", "logs", "conocimiento", "leads"] as const;

export default function AgentPage() {
  const { confirm } = useDialogs();
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const [agent, setAgent] = useState<any>(null);
  const [tab, setTab] = useState<string>(search.get("tab") ?? "chat");
  const [kbUrl, setKbUrl] = useState("");
  const [kbStatus, setKbStatus] = useState("");

  const load = useCallback(() => {
    api(`/api/agents/${id}`).then(setAgent).catch(() => setAgent({ error: true }));
  }, [id]);

  useEffect(load, [load]);

  if (!agent) return <p className="text-slate-500">Cargando…</p>;
  if (agent.error) return <p className="text-red-400">Agente no encontrado (¿backend corriendo en :4000?).</p>;

  async function ingest() {
    setKbStatus("Scrapeando e indexando…");
    let data = await api<any>("/api/knowledge", {
      method: "POST",
      body: JSON.stringify({ agentId: id, url: kbUrl }),
    });
    if (data.requiresConfirmation) {
      const overwriteDuplicates = await confirm({
        title: "Chunks duplicados",
        message: `Hay ${data.duplicates} chunks duplicados. ¿Quieres sobrescribirlos?`,
        confirmText: "Sobrescribir",
        cancelText: "Cancelar",
      });
      data = await api<any>("/api/knowledge", {
        method: "POST",
        body: JSON.stringify({ agentId: id, url: kbUrl, overwriteDuplicates }),
      });
    }
    setKbStatus(
      data.chunks != null
        ? `✓ ${data.chunks} chunks indexados de ${data.pages ?? 1} páginas`
        : `Error: ${data.error}`
    );
    setKbUrl("");
    load();
  }

  return (
    // Alto exacto del viewport (menos topbar h-16 y padding del main py-8) → sin scroll de página;
    // cada pestaña scrollea internamente si su contenido no cabe.
    <div className="flex flex-col h-[calc(100dvh-8rem-2px)] overflow-hidden">
      <div className="kicker mb-2">Agente</div>
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-3xl font-extrabold text-white">{agent.name}</h1>
        <span className="chip-accent">{agent.sector}</span>
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
        <div className="card p-6 space-y-4">
          <h3 className="font-semibold text-sm text-white">Skills instaladas</h3>
          {(!agent.skillStatus || agent.skillStatus.length === 0) ? (
            <p className="text-xs text-slate-500">Este agente no tiene skills asignadas.</p>
          ) : (
            <ul className="space-y-3">
              {agent.skillStatus.map((item: any) => (
                <li key={item.skillId} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-slate-300">{item.name}</span>
                  {item.state === "executable" && (
                    <span className="text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-2 py-0.5">
                      Ejecutable
                    </span>
                  )}
                  {item.state === "requires_connection" && (
                    <button
                      onClick={() => setTab("integraciones")}
                      className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-0.5 hover:bg-amber-400/20 transition"
                    >
                      Conecta {item.provider}
                    </button>
                  )}
                  {item.state === "informational" && (
                    <span className="text-xs text-slate-500 bg-slate-500/10 border border-slate-500/20 rounded px-2 py-0.5">
                      Informativa
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
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

      {tab === "conocimiento" && (
        <div className="card p-6 space-y-4">
          <h3 className="font-semibold text-sm text-white">Base de conocimiento (RAG)</h3>
          <p className="text-xs text-slate-500">
            {agent._count.knowledge} chunks indexados. Añade una URL para scrapearla e indexarla.
          </p>
          <div className="flex gap-2">
            <input
              className="input-dark flex-1"
              placeholder="https://web-del-cliente.com"
              value={kbUrl}
              onChange={(e) => setKbUrl(e.target.value)}
            />
            <button onClick={ingest} disabled={!kbUrl} className="btn-grad">
              Indexar
            </button>
          </div>
          {kbStatus && <p className="text-xs text-slate-400">{kbStatus}</p>}
        </div>
      )}
      </div>
    </div>
  );
}
