"use client";

// Hilo del OPERADOR (Minion 3A) del widget flotante de Telegram. Consume el proxy
// staff-authenticated /api/operator-chat/* del back AA (que a su vez habla con el
// gateway de OpenClaw). Es un hilo ÚNICO (sin lista de conversaciones):
//  - GET  /api/operator-chat/history?limit=50 → { messages: [{ id, role, text, createdAt }] }
//  - POST /api/operator-chat/send { text, clientMessageId } → 202 { accepted, clientMessageId }
// El 202 NO devuelve el id del turno en el gateway: la confirmación llega de forma
// asíncrona por polling del historial (ver reconcilePending).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { LIST_POLL_MS, THREAD_POLL_MS, pollMs } from "@/hooks/useTelegramInbox";

// ── DTO — misma forma que devuelve el proxy (back/src/routes/operator-chat.ts) ──

export interface OperatorMessage {
  id: string;
  /** role "user" = mensaje propio del staff; "assistant" = respuesta del operador. */
  role: "user" | "assistant";
  text: string;
  /** ISO normalizado por el back; null si el gateway no aportó timestamp. */
  createdAt: string | null;
  /** Solo local: propio insertado de forma optimista, aún no visto en el historial. */
  pending?: boolean;
}

/** Última respuesta del operador vista (ISO). Persistido como los convos de clientes. */
const LAST_SEEN_KEY = "aa-operator-last-seen";
/** Tolerancia de reloj front↔gateway al reconciliar optimistas contra el historial. */
const RECONCILE_SKEW_MS = 120_000;

// Kill-switch de polling (egress). El refresco (5-15s) pincha el back 24/7 mientras
// el widget este montado (feed del badge), aun con el panel cerrado. Como el chat de
// operador no se usa por ahora, default OFF: carga inicial una vez y nada mas.
// Reactivar con NEXT_PUBLIC_OPERATOR_CHAT_POLLING=on.
const OPERATOR_CHAT_POLLING_ENABLED =
  (process.env.NEXT_PUBLIC_OPERATOR_CHAT_POLLING ?? "off").toLowerCase() === "on";

function readLastSeen(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeLastSeen(iso: string) {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, iso);
  } catch {
    /* almacenamiento no disponible: el badge simplemente no persiste */
  }
}

/** Id de idempotencia extremo a extremo (el gateway deduplica por él). */
export function newOperatorClientMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** ¿502/503 del proxy? → gateway caído o sin configurar (estado "no disponible"). */
function isGatewayDown(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 502 || e.status === 503);
}

/**
 * Retira de `pending` los optimistas que el historial del servidor ya confirma.
 * Análogo a mergeServerPage (useTelegramInbox) pero SIN id compartido: el 202 del
 * proxy no devuelve el id del turno en el gateway, así que un optimista se da por
 * confirmado cuando aparece un turno `user` con el MISMO texto y createdAt dentro
 * de la ventana [sentAt - skew, ∞) (o sin timestamp — el gateway puede no darlo).
 * Cada turno del servidor consume como mucho UN optimista (envíos duplicados del
 * mismo texto siguen mostrando su burbuja hasta que llegue su propio turno).
 */
export function reconcilePending(
  pending: OperatorMessage[],
  server: OperatorMessage[],
): OperatorMessage[] {
  if (pending.length === 0) return pending;
  const pool = server.filter((m) => m.role === "user");
  const used = new Set<number>();
  return pending.filter((p) => {
    const idx = pool.findIndex((m, i) => {
      if (used.has(i) || m.text !== p.text) return false;
      if (m.createdAt == null || p.createdAt == null) return true;
      return (
        new Date(m.createdAt).getTime() >= new Date(p.createdAt).getTime() - RECONCILE_SKEW_MS
      );
    });
    if (idx === -1) return true;
    used.add(idx);
    return false;
  });
}

/**
 * @param active true cuando el panel está abierto en la pestaña «Operador»:
 *   acelera el polling a la cadencia de hilo (5s) y marca las respuestas como
 *   leídas. Inactivo, sigue sondeando a la cadencia de lista (15s) para
 *   alimentar el badge de no leídos del chip.
 */
export function useOperatorChat(active: boolean) {
  const [history, setHistory] = useState<OperatorMessage[]>([]);
  const [pendingOut, setPendingOut] = useState<OperatorMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  const sendingRef = useRef(false);
  sendingRef.current = sending;

  // Hidratar la última lectura (solo cliente).
  useEffect(() => {
    setLastSeen(readLastSeen());
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api<{ messages: OperatorMessage[] }>("/api/operator-chat/history?limit=50");
      const server = Array.isArray(res?.messages) ? res.messages : [];
      // Mismo ciclo de render (batching): el turno confirmado entra por `history`
      // a la vez que su optimista sale de `pending` → sin burbuja duplicada.
      setHistory(server);
      setPendingOut((prev) => reconcilePending(prev, server));
      setUnavailable(false);
      setError(null);
    } catch (e) {
      if (isGatewayDown(e)) {
        setUnavailable(true);
      } else {
        setError(e instanceof Error ? e.message : "No se pudo cargar el chat del operador");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Polling continuo mientras el widget esté montado (alimenta el badge incluso con
  // el panel cerrado); cadencia de hilo con la pestaña activa, de lista en reposo.
  useEffect(() => {
    void loadHistory();
    if (!OPERATOR_CHAT_POLLING_ENABLED) return;
    const t = setInterval(
      () => void loadHistory(),
      pollMs(active ? THREAD_POLL_MS : LIST_POLL_MS),
    );
    return () => clearInterval(t);
  }, [active, loadHistory]);

  const messages = useMemo(() => [...history, ...pendingOut], [history, pendingOut]);

  // ── No leídos: respuestas del operador posteriores a la última lectura ──
  // createdAt es ISO UTC → comparación lexicográfica == cronológica. Los turnos sin
  // timestamp no cuentan (evita un badge imposible de limpiar).
  const unread = useMemo(
    () =>
      history.filter(
        (m) => m.role === "assistant" && m.createdAt != null && (!lastSeen || m.createdAt > lastSeen),
      ).length,
    [history, lastSeen],
  );

  // Con la pestaña activa, marcar como leída la última respuesta visible.
  useEffect(() => {
    if (!active) return;
    const latest = history.reduce<string | null>(
      (acc, m) =>
        m.role === "assistant" && m.createdAt && (!acc || m.createdAt > acc) ? m.createdAt : acc,
      null,
    );
    if (!latest) return;
    setLastSeen((prev) => {
      if (prev && prev >= latest) return prev;
      writeLastSeen(latest);
      return latest;
    });
  }, [active, history]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || sendingRef.current) return;
      setSending(true);
      setError(null);
      const clientMessageId = newOperatorClientMessageId();
      const optimistic: OperatorMessage = {
        id: clientMessageId,
        role: "user",
        text: content,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      setPendingOut((prev) => [...prev, optimistic]);
      try {
        await api("/api/operator-chat/send", {
          method: "POST",
          body: JSON.stringify({ text: content, clientMessageId }),
        });
        // 202 aceptado: la burbuja queda en "enviando..." hasta que un poll del
        // historial devuelva el turno equivalente (reconcilePending la retira).
        void loadHistory();
      } catch (e) {
        // Fallo real de envío: retirar el optimista para no aparentar entregado.
        setPendingOut((prev) => prev.filter((m) => m.id !== clientMessageId));
        if (isGatewayDown(e)) {
          setUnavailable(true);
        } else {
          setError(e instanceof Error ? e.message : "No se pudo enviar el mensaje");
        }
      } finally {
        setSending(false);
      }
    },
    [loadHistory],
  );

  return { messages, loading, sending, unavailable, error, unread, send };
}
