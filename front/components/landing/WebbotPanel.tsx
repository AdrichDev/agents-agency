"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getWebbotKey, injectWebbot, removeWebbot } from "./webbot";

interface AgentLite {
  id: string;
  name: string;
  publicKey: string;
  channel?: string | null;
}

interface Props {
  files: Record<string, string>;
  onApply: (files: Record<string, string>) => void;
}

/**
 * Inserta/quita un webbot (widget de agente) en la landing generada.
 * El snippet se escribe en index.html antes de </body>.
 */
export function WebbotPanel({ files, onApply }: Props) {
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  const hasIndex = "index.html" in files;
  const indexHtml = files["index.html"] ?? "";
  const currentKey = getWebbotKey(indexHtml);
  const currentAgent = agents.find((a) => a.publicKey === currentKey) ?? null;

  useEffect(() => {
    api<AgentLite[]>("/api/agents")
      .then((list) => {
        setAgents(list);
        const active = list.find((a) => a.publicKey === currentKey);
        setSelected(active?.id ?? list[0]?.id ?? "");
      })
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function insert() {
    const agent = agents.find((a) => a.id === selected);
    if (!agent || !hasIndex) return;
    setBusy(true);
    onApply({ ...files, "index.html": injectWebbot(indexHtml, agent.publicKey) });
    setBusy(false);
  }

  function remove() {
    if (!hasIndex) return;
    setBusy(true);
    onApply({ ...files, "index.html": removeWebbot(indexHtml) });
    setBusy(false);
  }

  return (
    <div className="overflow-y-auto h-full p-4 space-y-4">
      <div>
        <p className="kicker mb-1">Webbot en la landing</p>
        <p className="text-xs text-slate-500">
          Inserta un chatbot flotante en tu landing. Atiende visitas y capta leads. Sobrevive a regeneraciones.
        </p>
      </div>

      {!hasIndex && (
        <div className="text-xs text-slate-400 text-center border-t border-white/5 pt-4">
          Genera la landing primero desde ✨ Prompts.
        </div>
      )}

      {hasIndex && loading && (
        <div className="text-xs text-slate-400 text-center">Cargando agentes...</div>
      )}

      {hasIndex && !loading && agents.length === 0 && (
        <div className="text-xs text-slate-400 text-center border-t border-white/5 pt-4">
          No tienes agentes.{" "}
          <a href="/agents/new" className="text-indigo-400 underline">
            Crea uno primero
          </a>
          .
        </div>
      )}

      {hasIndex && !loading && agents.length > 0 && (
        <div className="border-t border-white/5 pt-4 space-y-3">
          {currentAgent && (
            <div className="text-xs text-emerald-400">
              ✓ Webbot activo: <span className="font-medium">{currentAgent.name}</span>
            </div>
          )}

          <label className="text-xs text-slate-500 block">
            Agente
            <select
              className="input-dark text-sm mt-1 w-full"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="btn-grad w-full text-xs py-2"
            onClick={insert}
            disabled={busy || !selected}
          >
            {currentAgent ? "🔄 Cambiar webbot" : "🤖 Insertar webbot"}
          </button>

          {currentAgent && (
            <button
              className="btn-dark w-full text-xs py-2"
              onClick={remove}
              disabled={busy}
            >
              Quitar webbot
            </button>
          )}
        </div>
      )}
    </div>
  );
}
