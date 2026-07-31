"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { LLM_PROVIDERS } from "@/lib/models";

/**
 * Ajustes del agente (F5, "ajustes honestos" — design.md §C.7):
 * - SIN selector de reasoning_effort: el agente siempre usa tools y OpenAI
 *   rechaza reasoning_effort + tools (openai.ts lo elimina) — era decorativo.
 * - Selector de modelo OCULTO en runtime=openclaw con aviso: el modelo lo
 *   gestiona OpenClaw (target openclaw/aa-<id>), el valor de BD se ignora.
 * - Conserva nombre / prompt de sistema / temperatura (PATCH /api/agents/:id).
 */
export default function AgentModelPanel({ agent, onChange }: { agent: any; onChange: () => void }) {
  const isOpenclaw = agent.runtime === "openclaw";
  const [name, setName] = useState<string>(agent.name ?? "");
  const [systemPrompt, setSystemPrompt] = useState<string>(agent.systemPrompt ?? "");
  const [temperature, setTemperature] = useState<number>(agent.temperature ?? 0.7);
  const [model, setModel] = useState<string>(agent.model ?? "gpt-4.1-nano");
  // Ritmo en canales de mensajería (aa-canales-buffer-y-respuesta-partida).
  const [inboundBufferMs, setInboundBufferMs] = useState<number>(agent.inboundBufferMs ?? 0);
  const [replyMaxMessages, setReplyMaxMessages] = useState<number>(agent.replyMaxMessages ?? 1);
  const [replySplitPauseMs, setReplySplitPauseMs] = useState<number>(agent.replySplitPauseMs ?? 0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const dirty =
    name !== (agent.name ?? "") ||
    systemPrompt !== (agent.systemPrompt ?? "") ||
    temperature !== (agent.temperature ?? 0.7) ||
    inboundBufferMs !== (agent.inboundBufferMs ?? 0) ||
    replyMaxMessages !== (agent.replyMaxMessages ?? 1) ||
    replySplitPauseMs !== (agent.replySplitPauseMs ?? 0) ||
    (!isOpenclaw && model !== (agent.model ?? "gpt-4.1-nano"));

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const body: Record<string, unknown> = {
        name,
        systemPrompt,
        temperature,
        inboundBufferMs,
        replyMaxMessages,
        replySplitPauseMs,
      };
      // En openclaw el modelo se ignora en runtime — no se manda para no fingir efecto.
      if (!isOpenclaw) body.model = model;
      await api(`/api/agents/${agent.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setStatus("✓ Guardado");
      onChange();
      setTimeout(() => setStatus(""), 2500);
    } catch {
      setStatus("Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-6 space-y-4 max-w-xl">
      <div>
        <h3 className="font-semibold text-sm text-white">Ajustes del agente</h3>
        <p className="text-xs text-slate-500 mt-1">
          Nombre, personalidad y parámetros del modelo.
        </p>
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1">Nombre</label>
        <input
          className="input-dark w-full text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1">Prompt de sistema (personalidad)</label>
        <textarea
          className="input-dark w-full text-sm min-h-32"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1">
          Temperatura: <span className="text-slate-300">{temperature.toFixed(1)}</span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          className="w-full"
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
        />
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 space-y-3">
        <div>
          <p className="text-sm text-slate-200">Ritmo en WhatsApp y Telegram</p>
          <p className="text-xs text-slate-400 mt-1">
            Un cliente escribe en varios mensajes cortos y espera una sola respuesta, no cuatro.
            Estos ajustes no afectan al widget de la web.
          </p>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Esperar antes de responder</label>
          <select
            data-testid="agent-rhythm-buffer"
            className="input-dark text-sm w-full"
            value={inboundBufferMs}
            onChange={(e) => setInboundBufferMs(Number(e.target.value))}
          >
            <option value={0}>Responder a cada mensaje (por defecto)</option>
            <option value={3000}>Agrupar lo que llegue en 3 segundos</option>
            <option value={5000}>Agrupar lo que llegue en 5 segundos</option>
            <option value={10000}>Agrupar lo que llegue en 10 segundos</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Partir la respuesta</label>
          <select
            data-testid="agent-rhythm-split"
            className="input-dark text-sm w-full"
            value={replyMaxMessages}
            onChange={(e) => setReplyMaxMessages(Number(e.target.value))}
          >
            <option value={1}>Un solo mensaje (por defecto)</option>
            <option value={2}>Hasta 2 mensajes</option>
            <option value={3}>Hasta 3 mensajes</option>
          </select>
        </div>

        {replyMaxMessages > 1 && (
          <div>
            <label className="text-xs text-slate-400 block mb-1">Pausa entre mensajes</label>
            <select
              data-testid="agent-rhythm-pause"
              className="input-dark text-sm w-full"
              value={replySplitPauseMs}
              onChange={(e) => setReplySplitPauseMs(Number(e.target.value))}
            >
              <option value={0}>Sin pausa</option>
              <option value={1000}>1 segundo</option>
              <option value={2000}>2 segundos</option>
            </select>
          </div>
        )}
      </div>

      {isOpenclaw ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-xs text-amber-200">
          El modelo de este agente lo gestiona OpenClaw (target{" "}
          <code className="text-amber-100">openclaw/aa-{agent.id}</code>): el selector no aplica
          aquí. Cambia el modelo en la configuración de OpenClaw.
        </div>
      ) : (
        <div>
          <label className="text-xs text-slate-400 block mb-1">Modelo de IA</label>
          <select
            className="input-dark text-sm w-full"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {LLM_PROVIDERS.map((p) => (
              <optgroup key={p.id} label={p.label}>
                {p.models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            El esfuerzo de razonamiento no aplica a agentes (usan herramientas); se configura solo
            donde tiene efecto real (Configuración y Estudios de mercado).
          </p>
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button className="btn-grad text-sm" onClick={save} disabled={saving || !dirty}>
          {saving ? "Guardando..." : "Guardar"}
        </button>
        {status && <span className="text-xs text-emerald-400">{status}</span>}
      </div>
    </div>
  );
}
