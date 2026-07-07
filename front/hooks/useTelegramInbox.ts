"use client";

// Orquestación de la bandeja de Telegram del widget flotante (lista + hilo + envío).
// Consume los endpoints AA /api/channels/telegram/* con el cliente api() (Bearer).
// Polling: la lista se refresca siempre que el widget está montado (alimenta el badge
// de no leídos aunque el panel esté cerrado); el hilo solo mientras el panel está
// abierto y hay conversación activa.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

// ── DTOs — misma forma que devuelve el back AA (prisma Conversation/Message) ──

export interface TelegramMessage {
  id: string;
  conversationId?: string;
  /** role "user" = entrante (cliente de Telegram); "assistant" = saliente (bot/manual). */
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** Solo local: saliente insertado de forma optimista, aún sin confirmar por el back. */
  pending?: boolean;
}

export interface TelegramConversation {
  id: string;
  createdAt?: string;
  agent?: { name?: string } | null;
  lead?: { customerName?: string | null; email?: string | null; phone?: string | null } | null;
  metadata?: { telegramChatId?: number | string; externalId?: number | string } | null;
  messages?: TelegramMessage[];
}

// Cadencias de polling compartidas con el hilo del operador (useOperatorChat).
export const LIST_POLL_MS = 15_000;
export const THREAD_POLL_MS = 5_000;
/** Override de intervalos para e2e (localStorage); inerte en producción. */
const POLL_OVERRIDE_KEY = "aa-telegram-poll-ms";
/** Última lectura por conversación: { [conversationId]: createdAt ISO del último entrante visto }. */
const LAST_SEEN_KEY = "aa-telegram-last-seen";
const PULSE_MS = 4_000;

export function pollMs(defaultMs: number): number {
  if (typeof window === "undefined") return defaultMs;
  const raw = Number(window.localStorage.getItem(POLL_OVERRIDE_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : defaultMs;
}

function readLastSeen(): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAST_SEEN_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLastSeen(map: Record<string, string>) {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(map));
  } catch {
    /* almacenamiento no disponible: el badge simplemente no persiste */
  }
}

export function newClientMessageId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `manual-${rand}`;
}

/** Nombre visible de la conversación (mismo criterio que la antigua página /telegram). */
export function conversationName(c: TelegramConversation): string {
  const external = c.metadata?.externalId ?? c.metadata?.telegramChatId;
  return c.lead?.customerName || `Chat #${external != null ? String(external) : c.id.slice(0, 6)}`;
}

/**
 * Mezcla la página del servidor con los salientes locales que aún no aparecen en ella.
 * Motivo (bug real en creador_CRM): un poll del hilo lanzado mientras el envío estaba
 * en vuelo resolvía SIN el mensaje recién enviado y, al llegar después de la inserción
 * optimista, lo borraba de pantalla hasta el siguiente poll. Conservar los salientes
 * locales ausentes (por id) evita que el mensaje enviado desaparezca.
 */
export function mergeServerPage(
  server: TelegramMessage[],
  prev: TelegramMessage[],
): TelegramMessage[] {
  const seen = new Set(server.map((m) => m.id));
  const pendingOut = prev.filter((m) => m.role === "assistant" && !seen.has(m.id));
  if (pendingOut.length === 0) return server;
  // createdAt es ISO-8601 UTC → orden lexicográfico == orden cronológico.
  return [...server, ...pendingOut].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function useTelegramInbox(open: boolean) {
  const [conversations, setConversations] = useState<TelegramConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState<Record<string, string>>({});
  const [pulse, setPulse] = useState(false);

  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const sendingRef = useRef(false);
  sendingRef.current = sending;

  // Hidratar el mapa de últimas lecturas (solo cliente).
  useEffect(() => {
    setLastSeen(readLastSeen());
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const list = await api<TelegramConversation[]>("/api/channels/telegram/conversations");
      setConversations(Array.isArray(list) ? list : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las conversaciones");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string, showSpinner = false) => {
    if (showSpinner) setLoadingThread(true);
    try {
      const items = await api<TelegramMessage[]>(
        `/api/channels/telegram/conversations/${conversationId}/messages`,
      );
      // Solo aplica si sigue siendo la conversación activa (evita carreras de polling)
      // y sin pisar salientes locales que el servidor aún no devuelve (mergeServerPage).
      if (activeIdRef.current === conversationId) {
        setMessages((prev) => mergeServerPage(Array.isArray(items) ? items : [], prev));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el hilo");
    } finally {
      if (showSpinner) setLoadingThread(false);
    }
  }, []);

  // Lista: carga inicial + polling continuo mientras el widget esté montado.
  // Corre también con el panel cerrado porque alimenta el badge de no leídos.
  useEffect(() => {
    void loadConversations();
    const t = setInterval(() => void loadConversations(), pollMs(LIST_POLL_MS));
    return () => clearInterval(t);
  }, [loadConversations]);

  // Hilo: carga con spinner al cambiar de conversación + polling solo con panel abierto.
  useEffect(() => {
    if (!open || !activeId) {
      if (!activeId) setMessages([]);
      return;
    }
    void loadMessages(activeId, true);
    const t = setInterval(() => void loadMessages(activeId), pollMs(THREAD_POLL_MS));
    return () => clearInterval(t);
  }, [open, activeId, loadMessages]);

  // ── No leídos: entrantes ("user") posteriores a la última lectura por conversación ──

  const unreadByConversation = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of conversations) {
      const seenAt = lastSeen[c.id];
      map[c.id] = (c.messages ?? []).filter(
        (m) => m.role === "user" && (!seenAt || m.createdAt > seenAt),
      ).length;
    }
    return map;
  }, [conversations, lastSeen]);

  const unreadTotal = useMemo(
    () => Object.values(unreadByConversation).reduce((acc, n) => acc + n, 0),
    [unreadByConversation],
  );

  // Con el hilo abierto, marcar como leído el último entrante visible.
  useEffect(() => {
    if (!open || !activeId) return;
    const latestIn = [...messages].reverse().find((m) => m.role === "user");
    if (!latestIn) return;
    setLastSeen((prev) => {
      const current = prev[activeId];
      if (current && current >= latestIn.createdAt) return prev;
      const next = { ...prev, [activeId]: latestIn.createdAt };
      writeLastSeen(next);
      return next;
    });
  }, [open, activeId, messages]);

  // Pulso visual cuando el total de no leídos SUBE (delta entrante nuevo). La primera
  // página de datos solo pinta el badge, sin pulso, para no parpadear en cada carga.
  const prevUnreadRef = useRef<number | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (conversations.length === 0) return;
    const prev = prevUnreadRef.current;
    prevUnreadRef.current = unreadTotal;
    if (prev === null || unreadTotal <= prev) return;
    setPulse(true);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = setTimeout(() => setPulse(false), PULSE_MS);
  }, [unreadTotal, conversations.length]);
  useEffect(
    () => () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    },
    [],
  );

  const active = conversations.find((c) => c.id === activeId) ?? null;

  // Envío optimista con idempotencia: el back usa clientMsgId como id del mensaje,
  // así el saliente local y el confirmado comparten id (reintentos incluidos).
  const handleSend = useCallback(
    async (text: string) => {
      const conversationId = activeIdRef.current;
      const content = text.trim();
      if (!conversationId || !content || sendingRef.current) return;
      setSending(true);
      setError(null);
      const clientMsgId = newClientMessageId();
      const optimistic: TelegramMessage = {
        id: clientMsgId,
        conversationId,
        role: "assistant",
        content,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      setMessages((prevMessages) => [...prevMessages, optimistic]);
      try {
        const saved = await api<TelegramMessage>(
          `/api/channels/telegram/conversations/${conversationId}/messages`,
          { method: "POST", body: JSON.stringify({ content, clientMsgId }) },
        );
        setMessages((prevMessages) =>
          prevMessages.map((m) =>
            m.id === clientMsgId ? { ...(saved?.id ? saved : optimistic), pending: false } : m,
          ),
        );
        void loadConversations();
      } catch (e) {
        // Fallo real de envío: retirar el optimista para no aparentar entregado.
        setMessages((prevMessages) => prevMessages.filter((m) => m.id !== clientMsgId));
        setError(e instanceof Error ? e.message : "No se pudo enviar el mensaje");
      } finally {
        setSending(false);
      }
    },
    [loadConversations],
  );

  return {
    conversations,
    activeId,
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
  };
}
