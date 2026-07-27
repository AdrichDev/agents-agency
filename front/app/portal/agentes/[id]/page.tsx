"use client";

/**
 * H5 (aa-portal-cliente, T4.2) — Conversaciones de un asistente y su detalle.
 *
 * El aislamiento NO se resuelve aquí: el backend filtra por el tenant de la sesión y devuelve **404**
 * cuando el agente es de otro cliente. Esta página se limita a enseñar ese 404 como "no encontrado", y
 * eso es exactamente lo que debe hacer — un mensaje distinto ("no es tuyo") le confirmaría al cliente
 * que ese ID existe en otra cuenta.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import type { PortalConversation, PortalMessage, PortalPage } from "@/lib/portal";

/** Fecha y hora en formato local corto. */
function fecha(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PortalAgentPage() {
  const params = useParams<{ id: string }>();
  const agentId = params?.id;

  const [conversations, setConversations] = useState<PortalConversation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<PortalMessage[] | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const loadConversations = useCallback(
    async (from?: string) => {
      if (!agentId) return;
      setLoadingList(true);
      try {
        const qs = new URLSearchParams({ limit: "20" });
        if (from) qs.set("cursor", from);
        const page = await api<PortalPage<PortalConversation>>(
          `/api/portal/agents/${agentId}/conversations?${qs.toString()}`
        );
        // Acumular en vez de reemplazar: "Cargar más" añade la página siguiente.
        setConversations((prev) => (from ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (e: any) {
        setError(
          e?.status === 404
            ? "Asistente no encontrado."
            : (e?.message ?? "No se pudieron cargar las conversaciones")
        );
      } finally {
        setLoadingList(false);
      }
    },
    [agentId]
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selected) {
      setMessages(null);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    api<PortalPage<PortalMessage> & { conversation: unknown }>(
      `/api/portal/conversations/${selected}/messages?limit=100`
    )
      .then((page) => {
        if (!cancelled) setMessages(page.items);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/portal" className="text-sm text-slate-400 hover:text-white transition">
          ← Volver a mi portal
        </Link>
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-red-300">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/portal" className="text-sm text-slate-400 hover:text-white transition">
          ← Volver a mi portal
        </Link>
        <h1 className="text-2xl font-semibold text-white">Conversaciones</h1>
        <p className="text-sm text-slate-500">
          Conversaciones reales de tus clientes con este asistente.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[minmax(0,340px)_1fr]">
        <section className="rounded-2xl border border-edge bg-white/[0.02] p-4">
          {loadingList && conversations.length === 0 ? (
            <p className="text-sm text-slate-500">Cargando...</p>
          ) : conversations.length === 0 ? (
            <p className="text-sm text-slate-500">
              Todavía no hay conversaciones con este asistente.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-edge">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(c.id)}
                      aria-current={selected === c.id}
                      className={`w-full text-left px-2 py-3 rounded-lg transition ${
                        selected === c.id ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                      }`}
                    >
                      <span className="block text-sm text-white">{fecha(c.createdAt)}</span>
                      <span className="block text-xs text-slate-500">
                        {c.channel ?? "web"} · {c.messageCount}{" "}
                        {c.messageCount === 1 ? "mensaje" : "mensajes"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {cursor && (
                <button
                  type="button"
                  onClick={() => void loadConversations(cursor)}
                  disabled={loadingList}
                  className="mt-4 w-full rounded-xl border border-edge bg-white/5 px-4 py-2 text-sm text-slate-300 hover:bg-white/10 transition disabled:opacity-50"
                >
                  {loadingList ? "Cargando..." : "Cargar más"}
                </button>
              )}
            </>
          )}
        </section>

        <section className="rounded-2xl border border-edge bg-white/[0.02] p-4 min-h-[240px]">
          {!selected ? (
            <p className="text-sm text-slate-500">
              Elige una conversación para leerla.
            </p>
          ) : loadingMessages ? (
            <p className="text-sm text-slate-500">Cargando mensajes...</p>
          ) : !messages || messages.length === 0 ? (
            <p className="text-sm text-slate-500">Esta conversación no tiene mensajes.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    m.role === "user"
                      ? "self-start bg-white/[0.06] text-slate-200"
                      : "self-end bg-accent-gradient text-white"
                  }`}
                >
                  <span className="block whitespace-pre-wrap break-words">{m.content}</span>
                  <span className="mt-1 block text-[10px] opacity-60">{fecha(m.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
