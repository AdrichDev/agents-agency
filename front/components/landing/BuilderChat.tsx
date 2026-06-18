"use client";

import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import { DECALOGUE_AREAS } from "./types";
import type { ChatMessage } from "./types";

interface AnswerEntry {
  value: string;
  assumedByAI: boolean;
}

interface ChatResponse {
  question: string | null;
  done: boolean;
  answers: Record<string, AnswerEntry>;
  area: string | null;
}

function AnimatedDots() {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d === 3 ? 1 : d + 1)), 400);
    return () => clearInterval(id);
  }, []);
  return <span>{".".repeat(dots)}</span>;
}

interface Props {
  projectId: string;
  initialAnswers: Record<string, AnswerEntry>;
  initialMessages?: ChatMessage[];
  onDone: (answers: Record<string, AnswerEntry>) => void;
  /** Tras el decálogo, el chat sigue activo: aplica cambios vía /regenerate. */
  onRegenerate?: (feedback: string) => Promise<string>;
  /** Si ya hay archivos generados (necesario para regenerar). */
  hasFiles?: boolean;
}

export function BuilderChat({ projectId, initialAnswers, initialMessages, onDone, onRegenerate, hasFiles }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const [answers, setAnswers] = useState<Record<string, AnswerEntry>>(initialAnswers);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Optimiza en el cliente antes de subir: redimensiona a máx 1600px y exporta
  // webp. Así nunca choca con el límite de body del backend.
  function optimizeImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, 1600 / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("no ctx")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/webp", 0.85));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  async function handleImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const dataUrl = await optimizeImage(file);
      const res = await api<{ ok: boolean; url: string }>(`/api/landing/${projectId}/assets`, {
        method: "POST",
        body: JSON.stringify({ dataUrl }),
      });
      const url = res.url;
      // Inserta la URL en el input para que la referencies con contexto.
      setInput((v) => (v ? `${v} ${url}` : `Usa esta imagen: ${url}`));
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "⚠️ No se pudo subir la imagen." }]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const answeredCount = Object.keys(answers).length;
  const totalAreas = DECALOGUE_AREAS.length;
  const progress = Math.round((answeredCount / totalAreas) * 100);

  useEffect(() => {
    // Scroll SOLO el contenedor del chat, nunca el window: scrollIntoView
    // arrastraba el viewport y la página entera saltaba al cargar.
    const c = messagesContainerRef.current;
    if (c) c.scrollTop = c.scrollHeight;
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
    // Auto-start if no answers yet AND no prior messages
    if (answeredCount === 0 && (initialMessages ?? []).length === 0) {
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
    const withUser: ChatMessage[] = [...messages, { role: "user", content: userText }];
    setMessages(withUser);
    setBusy(true);

    try {
      // Post-decálogo: el chat pasa a modo asistente de cambios.
      if (done) {
        if (!onRegenerate) return;
        if (!hasFiles) {
          setMessages([
            ...withUser,
            { role: "assistant", content: "Primero genera la landing desde la pestaña ✨ Prompts. Después aplico tus cambios desde aquí." },
          ]);
          return;
        }
        const reply = await onRegenerate(userText);
        const finalMsgs: ChatMessage[] = [...withUser, { role: "assistant", content: reply }];
        setMessages(finalMsgs);
        api(`/api/landing/${projectId}/chat`, {
          method: "POST",
          body: JSON.stringify({ message: null, messages: finalMsgs }),
        }).catch(() => {});
        return;
      }

      const res = await api<ChatResponse>(`/api/landing/${projectId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: userText, messages: withUser }),
      });
      setAnswers(res.answers);

      let updated = withUser;
      if (res.question) {
        updated = [...withUser, { role: "assistant", content: res.question! }];
        setMessages(updated);
      }

      if (res.done) {
        const finalMsg: ChatMessage = { role: "assistant", content: "¡Perfecto! Ya tengo toda la información. Ahora generaré el prompt de diseño para tu landing. 🚀" };
        updated = [...updated, finalMsg];
        setMessages(updated);
        setDone(true);
        // Persist final state
        api(`/api/landing/${projectId}/chat`, {
          method: "POST",
          body: JSON.stringify({ message: null, messages: updated }),
        }).catch(() => {});
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
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-3 scrollbar-corp">
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
              Pensando<AnimatedDots />
            </div>
          </div>
        )}
      </div>

      {/* Input — siempre visible. Tras el decálogo cambia a modo asistente de cambios. */}
      <div className="px-4 pb-4 pt-2 border-t border-white/5">
        {done && (
          <div className="text-xs text-emerald-400 text-center mb-2">
            ✓ Decálogo completo
          </div>
        )}
        <p className="text-xs text-slate-500 mb-2">
          {done
            ? <>Pídeme cambios: <span className="text-indigo-400">"agrega testimonios"</span>, <span className="text-indigo-400">"color principal verde"</span>...</>
            : <>Responde o escribe <span className="text-indigo-400">"decide tú"</span> para que la IA decida</>}
        </p>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleImage(e.target.files?.[0])}
          />
          <button
            className="btn-dark px-3 py-2 text-sm"
            title="Adjuntar imagen (se optimiza y aloja)"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || busy}
          >
            {uploading ? "…" : "📎"}
          </button>
          <input
            className="input-dark flex-1 text-sm"
            placeholder={done ? "Pide un cambio..." : "Escribe tu respuesta..."}
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
    </div>
  );
}
