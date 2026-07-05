"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { api, getToken } from "@/lib/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  agent: { name: string };
  lead?: { customerName: string; email?: string; phone?: string };
  metadata?: { externalId?: string; telegramChatId?: number };
  messages: Message[];
}

const DEMO_CONVERSATIONS: Conversation[] = [
  {
    id: "demo-conv-1",
    agent: { name: "Ariadna" },
    lead: { customerName: "Clínica Norte S.L.", email: "info@clinicanorte.com", phone: "+34 600 111 222" },
    metadata: { externalId: "123456" },
    messages: [
      { id: "demo-msg-1", role: "user", content: "Hola, me gustaría agendar una cita para revisar la automatización.", createdAt: new Date(Date.now() - 3600000).toISOString() },
      { id: "demo-msg-2", role: "assistant", content: "¡Hola! Claro que sí, con mucho gusto. ¿Qué día te vendría bien?", createdAt: new Date(Date.now() - 3000000).toISOString() },
      { id: "demo-msg-3", role: "user", content: "El domingo 5 de Julio por la mañana si es posible.", createdAt: new Date(Date.now() - 2400000).toISOString() },
    ],
  },
  {
    id: "demo-conv-2",
    agent: { name: "Mateo" },
    lead: { customerName: "Innova Legal", phone: "+34 600 333 444" },
    metadata: { externalId: "789012" },
    messages: [
      { id: "demo-msg-4", role: "user", content: "Hola, ¿cómo funciona el onboarding de agente?", createdAt: new Date(Date.now() - 7200000).toISOString() },
    ],
  },
];

export default function TelegramPage() {
  const [conversations, setConversations] = useState<Conversation[]>(DEMO_CONVERSATIONS);
  const [selectedId, setSelectedId] = useState<string>("demo-conv-1");
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedConversation = useMemo(() => {
    return conversations.find((c) => c.id === selectedId) || conversations[0];
  }, [conversations, selectedId]);

  // Load conversations
  useEffect(() => {
    async function loadConversations() {
      const token = await getToken();
      if (!token) {
        setConversations(DEMO_CONVERSATIONS);
        setLoading(false);
        return;
      }
      try {
        const data = await api<Conversation[]>("/api/channels/telegram/conversations");
        if (data && Array.isArray(data)) {
          // If no conversations exist, fallback to demo
          setConversations(data.length > 0 ? data : DEMO_CONVERSATIONS);
          if (data.length > 0) {
            setSelectedId(data[0].id);
          }
        }
      } catch (err) {
        console.error("Error cargando conversaciones de Telegram:", err);
        setConversations(DEMO_CONVERSATIONS);
      } finally {
        setLoading(false);
      }
    }

    loadConversations();
    // Poll every 4 seconds for new incoming messages
    const interval = setInterval(loadConversations, 4000);
    return () => clearInterval(interval);
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedConversation?.messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !selectedConversation) return;

    const content = inputMessage.trim();
    setInputMessage("");
    setSending(true);

    const clientMsgId = `manual-msg-${Math.random().toString(36).slice(2, 9)}`;
    const optimisticMessage: Message = {
      id: clientMsgId,
      role: "assistant",
      content,
      createdAt: new Date().toISOString(),
    };

    // Optimistic update
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === selectedConversation.id) {
          return {
            ...c,
            messages: [...c.messages, optimisticMessage],
          };
        }
        return c;
      })
    );

    const token = await getToken();
    if (!token) {
      // Mock mode
      setTimeout(() => {
        setSending(false);
        // Simulate bot reply in mock mode after 1.5 seconds
        setTimeout(() => {
          const simulatedReply: Message = {
            id: `reply-${Math.random().toString(36).slice(2, 9)}`,
            role: "user",
            content: `[Respuesta automática] Gracias por tu mensaje: "${content}"`,
            createdAt: new Date().toISOString(),
          };
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id === selectedConversation.id) {
                return {
                  ...c,
                  messages: [...c.messages, simulatedReply],
                };
              }
              return c;
            })
          );
        }, 1500);
      }, 300);
      return;
    }

    try {
      await api(`/api/channels/telegram/conversations/${selectedConversation.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, clientMsgId }),
      });
    } catch (err) {
      console.error("Error enviando mensaje manual a Telegram:", err);
      // Remove optimistic message if failed
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === selectedConversation.id) {
            return {
              ...c,
              messages: c.messages.filter((m) => m.id !== clientMsgId),
            };
          }
          return c;
        })
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0c10]/40 backdrop-blur-xl shadow-2xl relative">
      {/* Background glow effects */}
      <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[var(--accent-1)]/10 blur-[80px]" />
      <div className="pointer-events-none absolute bottom-10 left-10 h-64 w-64 rounded-full bg-[var(--accent-2)]/5 blur-[80px]" />

      <div className="flex flex-1 min-h-0 relative z-10">
        {/* Conversations Sidebar */}
        <aside className="w-80 border-r border-white/10 flex flex-col min-h-0 bg-white/[0.01]">
          <div className="p-5 border-b border-white/10">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Canal Directo</span>
            <h2 className="text-xl font-black text-white mt-1">Telegram Chats</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="telegram-conversations-list">
            {loading && conversations.length === 0 ? (
              <div className="text-slate-500 text-center py-8 text-sm">Cargando chats...</div>
            ) : conversations.length === 0 ? (
              <div className="text-slate-500 text-center py-8 text-sm">No hay conversaciones activas.</div>
            ) : (
              conversations.map((conv) => {
                const name = conv.lead?.customerName || `Chat #${conv.metadata?.externalId || conv.id.slice(0, 6)}`;
                const isSelected = conv.id === selectedId;
                const lastMsg = conv.messages[conv.messages.length - 1];

                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedId(conv.id)}
                    className={`w-full text-left p-3.5 rounded-2xl border transition flex flex-col gap-1.5 ${
                      isSelected
                        ? "bg-white/[0.08] border-[var(--accent-1)]"
                        : "bg-white/[0.02] border-transparent hover:bg-white/[0.04]"
                    }`}
                    data-testid="telegram-chat-item"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-sm truncate max-w-[140px]">
                        {name}
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-wider text-[var(--accent-1)] bg-[var(--accent-1)]/10 px-2 py-0.5 rounded-md">
                        {conv.agent.name}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 truncate w-full">
                      {lastMsg ? lastMsg.content : "Sin mensajes aún"}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Chat Area */}
        <main className="flex-1 flex flex-col min-h-0 bg-white/[0.005]">
          {selectedConversation ? (
            <>
              {/* Chat Header */}
              <header className="p-5 border-b border-white/10 flex items-center justify-between bg-white/[0.01]">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-black text-white" data-testid="chat-header-name">
                      {selectedConversation.lead?.customerName || "Chat de Telegram"}
                    </h3>
                    <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
                  </div>
                  <div className="mt-1 text-xs text-slate-500 flex items-center gap-2">
                    <span>Agente asignado: <strong className="text-slate-300 font-semibold">{selectedConversation.agent.name}</strong></span>
                    <span>•</span>
                    <span>Chat ID: <strong className="text-slate-300 font-semibold">{selectedConversation.metadata?.externalId || "N/A"}</strong></span>
                  </div>
                </div>
                {selectedConversation.lead?.phone && (
                  <div className="text-right">
                    <div className="text-xs text-slate-400 font-bold">{selectedConversation.lead.phone}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{selectedConversation.lead.email || "Sin email"}</div>
                  </div>
                )}
              </header>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4" data-testid="telegram-messages-container">
                {selectedConversation.messages.map((msg) => {
                  const isUser = msg.role === "user";
                  return (
                    <div
                      key={msg.id}
                      className={`flex w-full ${isUser ? "justify-start" : "justify-end"}`}
                      data-testid="chat-message-row"
                    >
                      <div
                        className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm shadow-md transition-all ${
                          isUser
                            ? "bg-white/[0.04] text-slate-100 border border-white/5 rounded-bl-none"
                            : "bg-accent-gradient text-white rounded-br-none"
                        }`}
                        data-testid={`message-bubble-${msg.role}`}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                        <span className="block mt-1.5 text-[9px] text-slate-400 text-right opacity-80">
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input */}
              <form onSubmit={handleSendMessage} className="p-5 border-t border-white/10 bg-white/[0.01]">
                <div className="relative flex items-center gap-3">
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder={`Responder a ${selectedConversation.lead?.customerName || "cliente"}...`}
                    className="flex-1 rounded-2xl border border-white/10 bg-[#0b0c10]/60 px-5 py-3.5 text-sm text-white placeholder-slate-500 focus:border-[var(--accent-1)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-1)] transition-colors"
                    data-testid="chat-input"
                  />
                  <button
                    type="submit"
                    disabled={!inputMessage.trim() || sending}
                    className="rounded-2xl bg-accent-gradient px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-950/20 hover:scale-[1.02] active:scale-[0.98] transition disabled:opacity-40 disabled:pointer-events-none flex items-center gap-2"
                    data-testid="chat-send-button"
                  >
                    <span>Enviar</span>
                    <svg
                      className="h-4 w-4 transform rotate-90"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                    </svg>
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Selecciona una conversación para empezar.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
