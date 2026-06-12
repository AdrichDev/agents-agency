"use client";

import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import { DECALOGUE_AREAS } from "./types";

interface AnswerEntry {
  value: string;
  assumedByAI: boolean;
}

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

interface ChatResponse {
  question: string | null;
  done: boolean;
  answers: Record<string, AnswerEntry>;
  area: string | null;
}

interface Props {
  projectId: string;
  initialAnswers: Record<string, AnswerEntry>;
  onDone: (answers: Record<string, AnswerEntry>) => void;
}

export function BuilderChat({ projectId, initialAnswers, onDone }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerEntry>>(initialAnswers);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const answeredCount = Object.keys(answers).length;
  const totalAreas = DECALOGUE_AREAS.length;
  const progress = Math.round((answeredCount / totalAreas) * 100);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function startInterview() {
    if (started) return;
    setStarted(true);
    setBusy(true);
    try {
      const res = await api<ChatResponse>(`/api/landing/${projectId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: null }),
      });
      setAnswers(res.answers);
      if (res.question) {
        setMessages([{ role: "assistant", content: res.question }]);
      }
      if (res.done) { setDone(true); onDone(res.answers); }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // Auto-start if no answers yet
    if (answeredCount === 0) {
      startInterview();
    } else {
      // Resume from previous state
      setStarted(true);
      if (answeredCount >= totalAreas) {
        setDone(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendMessage() {
    if (!input.trim() || busy) return;
    const userText = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setBusy(true);

    try {
      const res = await api<ChatResponse>(`/api/landing/${projectId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: userText }),
      });
      setAnswers(res.answers);

      if (res.question) {
        setMessages((prev) => [...prev, { role: "assistant", content: res.question! }]);
      }

      if (res.done) {
        setDone(true);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "¡Perfecto! Ya tengo toda la información. Ahora generaré el prompt de diseño para tu landing. 🚀" },
        ]);
        onDone(res.answers);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Progress bar */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="kicker">Decálogo</span>
          <span className="text-xs text-slate-400">{answeredCount}/{totalAreas}</span>
        </div>
        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-white/5 border border-white/10 text-slate-200"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-400">
              <span className="animate-pulse">Pensando...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {!done && (
        <div className="px-4 pb-4 pt-2 border-t border-white/5">
          <p className="text-xs text-slate-500 mb-2">
            Responde o escribe <span className="text-indigo-400">"decide tú"</span> para que la IA decida
          </p>
          <div className="flex gap-2">
            <input
              className="input-dark flex-1 text-sm"
              placeholder="Escribe tu respuesta..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              disabled={busy}
            />
            <button
              className="btn-grad px-4 py-2 text-sm"
              onClick={sendMessage}
              disabled={busy || !input.trim()}
            >
              →
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="px-4 pb-4 pt-2 border-t border-white/5">
          <div className="text-xs text-emerald-400 text-center">
            ✓ Decálogo completo — puedes generar el prompt
          </div>
        </div>
      )}
    </div>
  );
}
