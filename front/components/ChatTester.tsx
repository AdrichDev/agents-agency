"use client";

import { useState } from "react";
import { api } from "@/lib/api";

/** Un chunk de conocimiento devuelto por la tool `search_knowledge`. */
interface KnowledgeChunk {
  source: string;
  content: string;
  distance: number;
}

/** Registro de una llamada a herramienta, tal como lo emite `/api/chat`. */
interface ToolCallRecord {
  tool: string;
  input: unknown;
  output: unknown;
  error?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  toolCalls?: ToolCallRecord[];
  tokensUsed?: number;
  model?: string;
  latencyMs?: number;
}

interface KbSource {
  source: string;
  chunks: number;
}

/**
 * Mapa `tool → {icon,label}` en lenguaje llano (AC7: nada de jerga cruda
 * visible). Herramientas no mapeadas caen en un icono/etiqueta genéricos.
 */
const TOOL_LABELS: Record<string, { icon: string; label: string }> = {
  search_knowledge: { icon: "🔍", label: "Consultó su conocimiento" },
  crear_reserva: { icon: "📅", label: "Creó una reserva" },
  consultar_disponibilidad: { icon: "📅", label: "Consultó disponibilidad" },
  guardar_lead: { icon: "👤", label: "Guardó un contacto" },
  consultar_pedido: { icon: "📦", label: "Consultó un pedido" },
  notificar: { icon: "🔔", label: "Notificó al propietario" },
  request_human_handoff: { icon: "🙋", label: "Pidió intervención humana" },
};

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  widget: "Widget web",
  api: "API",
};

function toolMeta(tool: string) {
  return TOOL_LABELS[tool] ?? { icon: "⚙️", label: tool };
}

function snippet(text: string, max = 120) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Renderiza una llamada a herramienta dentro del desglose de un turno. */
function ToolCallDetail({ toolCall }: { toolCall: ToolCallRecord }) {
  const meta = toolMeta(toolCall.tool);

  if (toolCall.error) {
    return (
      <div className="text-xs">
        <p className="text-slate-300">
          {meta.icon} {meta.label}
        </p>
        <p className="mt-0.5 text-red-400">⚠️ No pudo completar la acción: {toolCall.error}</p>
      </div>
    );
  }

  // Render especial: search_knowledge muestra fuente + fragmento + % de similitud,
  // nunca el JSON crudo (AC2/AC7).
  if (toolCall.tool === "search_knowledge") {
    const query =
      toolCall.input && typeof toolCall.input === "object" && "query" in (toolCall.input as Record<string, unknown>)
        ? String((toolCall.input as Record<string, unknown>).query)
        : "";
    const chunks = Array.isArray(toolCall.output) ? (toolCall.output as KnowledgeChunk[]) : [];
    return (
      <div className="text-xs space-y-1">
        <p className="text-slate-300">
          {meta.icon} {meta.label}
        </p>
        {query && <p className="text-slate-500">Búsqueda: "{query}"</p>}
        {chunks.length === 0 ? (
          <p className="text-slate-600">Sin resultados en el conocimiento indexado.</p>
        ) : (
          <ul className="space-y-0.5">
            {chunks.map((c, i) => (
              <li key={i} className="text-slate-400">
                • {c.source} — "{snippet(c.content)}" ({Math.round((1 - c.distance) * 100)}%)
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="text-xs space-y-1">
      <p className="text-slate-300">
        {meta.icon} {meta.label}
      </p>
      <pre className="rounded-lg bg-black/20 px-2 py-1.5 text-[11px] whitespace-pre-wrap break-words text-slate-500">
        Entrada: {safeStringify(toolCall.input)}
      </pre>
      <pre className="rounded-lg bg-black/20 px-2 py-1.5 text-[11px] whitespace-pre-wrap break-words text-slate-500">
        Resultado: {safeStringify(toolCall.output)}
      </pre>
    </div>
  );
}

/**
 * Consola de pruebas del agente (antes "ChatTester" mostraba solo `data.text` y
 * descartaba `toolCalls`/`tokensUsed`). Consume el `AgentReply` completo de
 * `/api/chat` (test:true) y traduce cada acción del agente a lenguaje llano,
 * colapsada por defecto — la conversación normal queda a la vista, el "por
 * qué" se despliega bajo demanda (aa-agente-consola-pruebas, design.md §C).
 */
export default function ChatTester({
  agentId,
  agentChannel,
  agentModel,
  knowledgeSources,
  onGoToKnowledge,
}: {
  agentId: string;
  agentChannel?: string;
  agentModel?: string;
  knowledgeSources?: KbSource[];
  onGoToKnowledge?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const totalChunks = (knowledgeSources ?? []).reduce((sum, s) => sum + s.chunks, 0);
  const hasKnowledge = totalChunks > 0;
  const channelLabel = agentChannel ? (CHANNEL_LABELS[agentChannel] ?? agentChannel) : "—";
  const modelLabel = agentModel ?? "gpt-4.1-nano";

  function toggleExpand(i: number) {
    setExpanded((e) => ({ ...e, [i]: !e[i] }));
  }

  function reset() {
    setMessages([]);
    setConversationId(undefined);
    setExpanded({});
    setInput("");
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      // test:true → el backend marca la conversación como de prueba (no ensucia
      // listados/analítica del cliente).
      const data = await api<any>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ agentId, message: text, conversationId, test: true }),
      });
      setConversationId(data.conversationId ?? conversationId);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: data.text ?? data.error ?? "Error",
          toolCalls: Array.isArray(data.toolCalls) ? data.toolCalls : undefined,
          tokensUsed: typeof data.tokensUsed === "number" ? data.tokensUsed : undefined,
          model: typeof data.model === "string" ? data.model : undefined,
          latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : undefined,
        },
      ]);
    } catch (e: any) {
      // Mostrar el motivo real (ApiError lleva el mensaje del backend) en vez de
      // asumir siempre "sin conexión".
      const detail = e?.message ? `: ${e.message}` : " (:4000)";
      setMessages((m) => [...m, { role: "assistant", text: `Error${detail}` }]);
    }
    setBusy(false);
  }

  return (
    <div className="card flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-2.5">
        <p className="text-xs text-slate-500">Consola de pruebas — no afecta a tus clientes reales.</p>
        <button type="button" onClick={reset} className="btn-dark !px-3 !py-1.5 !text-xs">
          Reiniciar
        </button>
      </div>

      <div className="px-4 pt-3">
        <div
          className={`rounded-xl border px-3.5 py-2.5 text-xs ${
            hasKnowledge
              ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-200"
              : "border-amber-400/30 bg-amber-400/5 text-amber-200"
          }`}
        >
          <span>{hasKnowledge ? "🟢 Listo para probar" : "🟡 Aún sin conocimiento"}</span>
          <span className="text-slate-500"> · Canal: {channelLabel}</span>
          <span className="text-slate-500">
            {" "}
            · Conocimiento: {totalChunks} fragmento{totalChunks === 1 ? "" : "s"} indexado
            {totalChunks === 1 ? "" : "s"}
          </span>
          <span className="text-slate-500"> · Modelo: {modelLabel}</span>
          {!hasKnowledge && (
            <p className="mt-1 text-amber-300">
              El agente no sabrá nada del negocio.{" "}
              {onGoToKnowledge && (
                <button type="button" onClick={onGoToKnowledge} className="underline hover:text-amber-100">
                  Ir a la pestaña Conocimiento
                </button>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-600">
            Háblale a tu agente como lo haría un cliente real para ver cómo responde antes de publicarlo.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <div
              className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "ml-auto bg-neon-gradient text-white"
                  : "bg-white/5 border border-edge text-slate-300"
              }`}
            >
              {m.text}
            </div>
            {m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0 && (
              <div className="mt-1.5 max-w-[85%] rounded-xl border border-edge bg-white/5">
                <button
                  type="button"
                  onClick={() => toggleExpand(i)}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-slate-400 hover:text-slate-200"
                >
                  <span>{expanded[i] ? "▾" : "▸"}</span>
                  <span>
                    Ver qué hizo el agente ({m.toolCalls.length} acción{m.toolCalls.length === 1 ? "" : "es"})
                  </span>
                </button>
                {expanded[i] && (
                  <div className="space-y-2.5 border-t border-edge px-3 pb-3 pt-2.5">
                    {m.toolCalls.map((tc, j) => (
                      <ToolCallDetail key={j} toolCall={tc} />
                    ))}
                  </div>
                )}
              </div>
            )}
            {m.role === "assistant" && (m.latencyMs != null || m.tokensUsed != null || m.model) && (
              <div className="ml-1 mt-1 text-[11px] text-slate-600">
                {m.latencyMs != null && <>⚡ {(m.latencyMs / 1000).toFixed(1)} s</>}
                {m.tokensUsed != null && <> · {m.tokensUsed} tokens</>}
                {m.model && <> · {m.model}</>}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="bg-white/5 border border-edge px-4 py-2.5 rounded-2xl text-sm text-slate-400">
            El agente está pensando…
          </div>
        )}
      </div>
      <form onSubmit={send} className="border-t border-edge flex p-2 gap-2">
        <input
          className="input-dark !rounded-xl flex-1"
          placeholder="Escribe como si fueras el cliente…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn-grad !px-4" disabled={busy}>Enviar</button>
      </form>
    </div>
  );
}
