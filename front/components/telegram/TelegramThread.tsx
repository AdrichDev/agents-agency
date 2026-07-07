"use client";

// Detalle de una conversación de Telegram dentro del widget flotante: hilo en vivo +
// formulario de respuesta. Componente presentacional: recibe mensajes y callbacks,
// no habla con la API (la orquestación vive en useTelegramInbox), así es testeable
// sin mockear red.
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import {
  conversationName,
  type TelegramConversation,
  type TelegramMessage,
} from "@/hooks/useTelegramInbox";

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toTimeString().slice(0, 5);
};

export default function TelegramThread({
  conversation,
  messages,
  loading = false,
  sending = false,
  onSend,
  outRole = "assistant",
}: {
  conversation: TelegramConversation | null;
  messages: TelegramMessage[];
  loading?: boolean;
  sending?: boolean;
  onSend: (text: string) => void;
  /**
   * Rol que se pinta como burbuja saliente (derecha/acento). En los hilos con
   * clientes el saliente es "assistant" (bot/manual); en el hilo del OPERADOR el
   * saliente es "user" (los mensajes propios del staff hacia el Minion 3A).
   */
  outRole?: "user" | "assistant";
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  // Autoscroll al último mensaje. Se ancla al id del último (no a length): un poll
  // puede sustituir la página manteniendo el mismo número pero con un último distinto.
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [lastMessageId, conversation?.id]);

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-slate-500">
        Elige una conversación para ver el chat.
      </div>
    );
  }

  function submit() {
    const text = draft.trim();
    if (!text || sending) return;
    onSend(text);
    setDraft("");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex-1 space-y-2 overflow-y-auto px-4 py-3"
        data-testid="telegram-widget-thread"
      >
        {loading && messages.length === 0 ? (
          <p className="text-sm text-slate-500">Cargando mensajes...</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-slate-500">No hay mensajes todavía.</p>
        ) : (
          messages.map((m) => {
            const isOut = m.role === outRole;
            return (
              <div
                key={m.id}
                data-direction={isOut ? "out" : "in"}
                className={`flex ${isOut ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    isOut
                      ? "bg-accent-gradient text-white shadow-lg shadow-indigo-950/30"
                      : "border border-white/10 bg-white/[0.06] text-slate-200"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  <p className={`mt-1 text-[10px] ${isOut ? "text-white/70" : "text-slate-500"}`}>
                    {hhmm(m.createdAt)}
                    {isOut && m.pending ? " · enviando..." : ""}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-end gap-2">
          <textarea
            aria-label="Escribe una respuesta"
            data-testid="telegram-widget-input"
            className="min-h-[42px] flex-1 resize-none rounded-xl border border-[rgba(255,255,255,0.1)] bg-transparent px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-[var(--accent-1)] focus:outline-none"
            placeholder="Escribe una respuesta..."
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary flex items-center gap-1.5 text-xs font-bold"
            data-testid="telegram-widget-send"
            disabled={sending || !draft.trim()}
            onClick={submit}
          >
            <Send className="h-4 w-4" />
            {sending ? "Enviando..." : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
