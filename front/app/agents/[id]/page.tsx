"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import ChatTester from "@/components/ChatTester";
import IntegrationsPanel from "@/components/IntegrationsPanel";
import AutomationsPanel from "@/components/AutomationsPanel";
import DeployPanel from "@/components/DeployPanel";
import LogsPanel from "@/components/LogsPanel";

const TABS = ["chat", "integraciones", "automatizaciones", "deploy", "logs", "conocimiento"] as const;

export default function AgentPage() {
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
      const overwriteDuplicates = window.confirm(
        `Hay ${data.duplicates} chunks duplicados. ¿Quieres sobrescribirlos?`
      );
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

      <div className="flex gap-1 border-b border-edge mb-7 overflow-x-auto">
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

      {tab === "integraciones" && (
        <IntegrationsPanel
          agentId={agent.id}
          connected={agent.integrations.map((i: any) => i.provider)}
          onChange={load}
        />
      )}

      {tab === "automatizaciones" && (
        <AutomationsPanel agentId={agent.id} automations={agent.automations} onChange={load} />
      )}

      {tab === "deploy" && <DeployPanel agent={agent} onChange={load} />}

      {tab === "logs" && <LogsPanel automations={agent.automations} />}

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
