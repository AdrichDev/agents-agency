"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export default function ChatTester({ agentId }: { agentId: string }) {
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const data = await api<any>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ agentId, message: text, conversationId }),
      });
      setConversationId(data.conversationId ?? conversationId);
      setMessages((m) => [...m, { role: "assistant", text: data.text ?? data.error ?? "Error" }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Error de conexión con el backend (:4000)" }]);
    }
    setBusy(false);
  }

  return (
    <div className="card flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-600">Prueba tu agente aquí antes de desplegarlo.</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
              m.role === "user"
                ? "ml-auto bg-neon-gradient text-white"
                : "bg-white/5 border border-edge text-slate-300"
            }`}
          >
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="bg-white/5 border border-edge px-4 py-2.5 rounded-2xl text-sm w-14 text-slate-400">
            …
          </div>
        )}
      </div>
      <form onSubmit={send} className="border-t border-edge flex p-2 gap-2">
        <input
          className="input-dark !rounded-xl flex-1"
          placeholder="Escribe un mensaje…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn-grad !px-4" disabled={busy}>Enviar</button>
      </form>
    </div>
  );
}
