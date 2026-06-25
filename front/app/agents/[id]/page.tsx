"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, API, getToken } from "@/lib/api";
import ChatTester from "@/components/ChatTester";
import IntegrationsPanel from "@/components/IntegrationsPanel";
import ChannelConnectPanel from "@/components/ChannelConnectPanel";
import AutomationsPanel from "@/components/AutomationsPanel";
import DeployPanel from "@/components/DeployPanel";
import LogsPanel from "@/components/LogsPanel";
import LeadsPanel from "@/components/LeadsPanel";
import EcommerceConfigPanel from "@/components/EcommerceConfigPanel";
import AgentModelPanel from "@/components/AgentModelPanel";
import { useDialogs } from "@/components/ui/ConfirmProvider";

const TABS = ["chat", "skills", "integraciones", "automatizaciones", "deploy", "logs", "conocimiento", "leads", "ajustes"] as const;

export default function AgentPage() {
  const { confirm } = useDialogs();
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const [agent, setAgent] = useState<any>(null);
  const [tab, setTab] = useState<string>(search.get("tab") ?? "chat");
  const [kbUrl, setKbUrl] = useState("");
  const [kbStatus, setKbStatus] = useState("");
  const [sources, setSources] = useState<{ source: string; chunks: number }[]>([]);
  const [fileList, setFileList] = useState<FileList | null>(null);
  const [fileResults, setFileResults] = useState<
    { source: string; chunks: number; duplicates: number; note?: string }[]
  >([]);
  const [fileUploading, setFileUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api(`/api/agents/${id}`).then(setAgent).catch(() => setAgent({ error: true }));
  }, [id]);

  const loadSources = useCallback(() => {
    api<{ sources: { source: string; chunks: number }[] }>(`/api/knowledge/${id}/sources`)
      .then((d) => setSources(d.sources))
      .catch(() => setSources([]));
  }, [id]);

  useEffect(load, [load]);
  useEffect(loadSources, [loadSources]);

  async function deleteSource(source: string) {
    const ok = await confirm({
      title: "Borrar fuente",
      message: `¿Borrar todos los chunks indexados de "${source}"?`,
      confirmText: "Borrar",
      cancelText: "Cancelar",
    });
    if (!ok) return;
    await api(`/api/knowledge/${id}/sources`, {
      method: "DELETE",
      body: JSON.stringify({ source }),
    });
    loadSources();
    load();
  }

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
    loadSources();
  }

  async function uploadFiles(overwriteDuplicates?: boolean) {
    if (!fileList || fileList.length === 0) return;
    setFileUploading(true);
    setFileResults([]);
    try {
      const formData = new FormData();
      for (const file of Array.from(fileList)) {
        formData.append("files", file);
      }
      if (overwriteDuplicates !== undefined) {
        formData.append("overwriteDuplicates", String(overwriteDuplicates));
      }

      // Raw fetch — do NOT use api() helper (it forces Content-Type: application/json).
      // No fijamos Content-Type: el browser pone el boundary multipart automáticamente.
      const token = await getToken();
      const res = await fetch(`${API}/api/knowledge/${id}/files`, {
        method: "POST",
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      const data: {
        files: { source: string; chunks: number; duplicates: number; note?: string }[];
        requiresConfirmation: boolean;
      } = await res.json();

      if (!res.ok) {
        setFileResults([{ source: "error", chunks: 0, duplicates: 0, note: (data as any).error ?? `Error ${res.status}` }]);
        return;
      }

      if (data.requiresConfirmation) {
        const overwrite = await confirm({
          title: "Chunks duplicados",
          message: `Hay archivos con chunks duplicados. ¿Quieres sobrescribirlos?`,
          confirmText: "Sobrescribir",
          cancelText: "Cancelar",
        });
        // Re-POST with resolved policy.
        await uploadFiles(overwrite);
        return;
      }

      setFileResults(data.files);
      // Reset file input.
      setFileList(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadSources();
      load();
    } finally {
      setFileUploading(false);
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

      {tab === "ajustes" && <AgentModelPanel agent={agent} onChange={load} />}

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

          {/* File upload */}
          <div className="border-t border-edge pt-4 space-y-2">
            <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
              Subir archivos
            </h4>
            {/* Input nativo oculto: evita el "ningún archivo seleccionado" del navegador. */}
            <input
              ref={fileInputRef}
              id="kb-file-input"
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md,.html,.htm,.csv,.zip"
              className="hidden"
              onChange={(e) => setFileList(e.target.files)}
            />
            <label
              htmlFor="kb-file-input"
              className="btn-dark cursor-pointer text-center inline-block py-1.5 px-3 text-[11px] font-bold"
            >
              📎 Seleccionar archivos
            </label>
            <p className="text-[10px] text-slate-500">pdf, docx, txt, md, html, csv o .zip</p>

            {fileList && fileList.length > 0 && (
              <div className="space-y-2 pt-1">
                <ul className="text-xs text-slate-400 space-y-0.5">
                  {Array.from(fileList).map((f, i) => (
                    <li key={i} className="truncate" title={f.name}>• {f.name}</li>
                  ))}
                </ul>
                <button
                  onClick={() => uploadFiles()}
                  disabled={fileUploading}
                  className="btn-grad text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {fileUploading ? "Subiendo…" : `Subir ${fileList.length} archivo${fileList.length > 1 ? "s" : ""}`}
                </button>
              </div>
            )}
            {fileResults.length > 0 && (
              <ul className="mt-2 space-y-1">
                {fileResults.map((r, i) => (
                  <li key={i} className="text-xs text-slate-300 flex gap-2">
                    <span className="truncate text-slate-400" title={r.source}>{r.source}</span>
                    {r.note ? (
                      <span className="text-amber-400">{r.note}</span>
                    ) : (
                      <span className="text-emerald-400">{r.chunks} chunks</span>
                    )}
                    {r.duplicates > 0 && (
                      <span className="text-yellow-400">({r.duplicates} duplicados)</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Fuentes indexadas */}
          <div className="border-t border-edge pt-4">
            <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
              Fuentes indexadas ({sources.length})
            </h4>
            {sources.length === 0 ? (
              <p className="text-xs text-slate-500">Aún no hay fuentes. Añade una URL arriba.</p>
            ) : (
              <ul className="space-y-1.5">
                {sources.map((s) => (
                  <li key={s.source} className="flex items-center justify-between gap-3 text-xs bg-black/20 border border-edge rounded-lg px-3 py-2">
                    <span className="text-slate-300 truncate" title={s.source}>{s.source}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-slate-500">{s.chunks} chunks</span>
                      <button
                        onClick={() => deleteSource(s.source)}
                        className="text-rose-400 hover:text-rose-300"
                        title="Borrar fuente"
                      >
                        🗑
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
