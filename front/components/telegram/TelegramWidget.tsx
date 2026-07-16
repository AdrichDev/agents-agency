"use client";

// Widget flotante de Telegram: chip fijo abajo-derecha visible en toda la consola.
// Es la ÚNICA UI del canal (la página /telegram fue retirada). Al pulsarlo abre un
// panel con dos pestañas:
//  - «Operador» (por defecto): hilo único con el agente operador (Minion 3A) vía el
//    proxy /api/operator-chat/* (orquestación en useOperatorChat).
//  - «Clientes»: conversaciones cliente-bot de /api/channels/telegram/* (lista →
//    hilo, patrón móvil; orquestación en useTelegramInbox).
// El badge del chip suma los no leídos de ambas pestañas. Un fallo del gateway del
// operador solo degrada su pestaña («Operador no disponible»), nunca la de clientes.
import { useMemo, useState } from "react";
import { ArrowLeft, MessageCircle, X } from "lucide-react";
import Image from "next/image";
import gruAvatar from "@/assets/gru.webp";
import TelegramThread from "@/components/telegram/TelegramThread";
import {
  conversationName,
  useTelegramInbox,
  type TelegramConversation,
  type TelegramMessage,
} from "@/hooks/useTelegramInbox";
import { useOperatorChat } from "@/hooks/useOperatorChat";

/** Conversación sintética del hilo del operador (TelegramThread exige una no-nula). */
const OPERATOR_CONVERSATION: TelegramConversation = {
  id: "operator-thread",
  lead: { customerName: "Operador" },
};

export default function TelegramWidget() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"operator" | "clients">("operator");
  const [view, setView] = useState<"list" | "thread">("list");

  const {
    conversations,
    setActiveId,
    active,
    messages,
    loadingList,
    loadingThread,
    sending,
    error,
    handleSend,
    unreadByConversation,
    unreadTotal,
    pulse,
  } = useTelegramInbox(open);

  const operator = useOperatorChat(open && tab === "operator");

  // Adaptación DTO operador → TelegramThread (text→content; createdAt null → "",
  // hhmm lo pinta como vacío sin romper).
  const operatorMessages = useMemo<TelegramMessage[]>(
    () =>
      operator.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.text,
        createdAt: m.createdAt ?? "",
        pending: m.pending,
      })),
    [operator.messages],
  );

  const badgeTotal = unreadTotal + operator.unread;

  function openConversation(id: string) {
    setActiveId(id);
    setView("thread");
  }

  const tabClass = (selected: boolean) =>
    `flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] transition ${
      selected
        ? "border-white/15 bg-white/10 text-white"
        : "border-transparent text-slate-400 hover:bg-white/5 hover:text-white"
    }`;

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Mensajes de la agencia"
          data-testid="telegram-widget-panel"
          className="fixed bottom-24 right-5 z-50 flex h-[70vh] max-h-[560px] w-[min(92vw,380px)] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0c10]/95 shadow-2xl backdrop-blur-xl"
        >
          <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[var(--accent-1)]/20 blur-[50px]" />

          <div className="relative z-10 flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              {tab === "clients" && view === "thread" && (
                <button
                  type="button"
                  onClick={() => setView("list")}
                  aria-label="Volver a la lista"
                  className="rounded-xl border border-white/10 p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <Image
                src={gruAvatar}
                alt="Gru - 3A Estudio"
                width={36}
                height={36}
                className="h-9 w-9 shrink-0 rounded-full object-cover object-center"
              />
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  {tab === "operator"
                    ? "Operador"
                    : view === "thread" && active
                      ? conversationName(active)
                      : "Canal directo"}
                </div>
                <div className="truncate font-black text-white" data-testid="telegram-widget-title">
                  Gru - 3A Estudio
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar panel de Telegram"
              className="rounded-xl border border-white/10 p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            role="tablist"
            aria-label="Pestañas del panel"
            className="relative z-10 flex gap-1.5 border-b border-white/10 px-3 py-2"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "operator"}
              data-testid="telegram-widget-tab-operator"
              onClick={() => setTab("operator")}
              className={tabClass(tab === "operator")}
            >
              Operador
              {operator.unread > 0 && (
                <span
                  data-testid="telegram-widget-tab-operator-unread"
                  className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-2)] px-1 text-[9px] font-black text-white"
                >
                  {operator.unread}
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "clients"}
              data-testid="telegram-widget-tab-clients"
              onClick={() => setTab("clients")}
              className={tabClass(tab === "clients")}
            >
              Clientes
              {unreadTotal > 0 && (
                <span
                  data-testid="telegram-widget-tab-clients-unread"
                  className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-2)] px-1 text-[9px] font-black text-white"
                >
                  {unreadTotal}
                </span>
              )}
            </button>
          </div>

          <div className="relative z-10 min-h-0 flex-1">
            {tab === "operator" ? (
              operator.unconfigured ? (
                <div
                  data-testid="telegram-widget-operator-unconfigured"
                  className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center"
                >
                  <p className="text-sm font-bold text-slate-300">Chat de operador no configurado</p>
                  <p className="text-xs text-slate-500">
                    Esta función todavía no está disponible en este entorno.
                  </p>
                </div>
              ) : operator.unavailable ? (
                <div
                  data-testid="telegram-widget-operator-unavailable"
                  className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center"
                >
                  <p className="text-sm font-bold text-slate-300">Operador no disponible</p>
                  <p className="text-xs text-slate-500">
                    No se pudo conectar con el agente operador. Reintentando automáticamente...
                  </p>
                </div>
              ) : (
                <TelegramThread
                  conversation={OPERATOR_CONVERSATION}
                  messages={operatorMessages}
                  loading={operator.loading}
                  sending={operator.sending}
                  onSend={operator.send}
                  outRole="user"
                />
              )
            ) : error && conversations.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                No se pudieron cargar las conversaciones.
              </div>
            ) : view === "list" ? (
              <div className="h-full overflow-y-auto p-2" data-testid="telegram-widget-conversations">
                {loadingList && conversations.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-500">Cargando chats...</div>
                ) : conversations.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-500">
                    No hay conversaciones activas.
                  </div>
                ) : (
                  conversations.map((c) => {
                    const last = c.messages?.[c.messages.length - 1];
                    const unread = unreadByConversation[c.id] ?? 0;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => openConversation(c.id)}
                        className="flex w-full items-start gap-2.5 rounded-2xl border border-transparent px-3 py-2.5 text-left transition hover:border-edge hover:bg-white/[0.04]"
                        data-testid="telegram-widget-conversation"
                      >
                        <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-1)]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-200">
                            {conversationName(c)}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {last ? last.content : "Sin mensajes"}
                          </span>
                        </span>
                        {unread > 0 && (
                          <span
                            data-testid="telegram-widget-conv-unread"
                            className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent-2)] px-1.5 text-[10px] font-black text-white"
                          >
                            {unread}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            ) : (
              <TelegramThread
                conversation={active}
                messages={messages}
                loading={loadingThread}
                sending={sending}
                onSend={handleSend}
              />
            )}
          </div>
        </div>
      )}

      {/* El chip flotante SOLO se muestra con el panel cerrado. Al abrir, el
          panel ya tiene su propia X de cerrar en la cabecera → el chip se oculta
          para no duplicar el control. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir Telegram"
          aria-expanded={false}
          data-testid="telegram-widget-chip"
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-accent-gradient text-white shadow-lg shadow-indigo-950/40 transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[var(--accent-1)]"
        >
          {pulse && (
            <span
              data-testid="telegram-widget-pulse"
              className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-1)] opacity-60"
            />
          )}
          <span className="relative z-10">
            <Image
              src={gruAvatar}
              alt="Gru - 3A Estudio"
              width={48}
              height={48}
              className="h-12 w-12 rounded-full object-cover object-center"
              priority
            />
          </span>
          {badgeTotal > 0 && (
            <span
              data-testid="telegram-widget-unread"
              className="absolute -right-1 -top-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white"
            >
              {badgeTotal}
            </span>
          )}
        </button>
      )}
    </>
  );
}
