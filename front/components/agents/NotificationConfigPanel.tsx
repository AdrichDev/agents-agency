"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

const EVENTS = [
  { id: "nueva_reserva", label: "Nueva reserva" },
  { id: "nuevo_lead", label: "Nuevo lead" },
  { id: "handoff", label: "Escalado a humano" },
] as const;

/** Intervalo de sondeo del pairing y tope de espera (design.md §E). */
const PAIRING_POLL_MS = 2_000;
const PAIRING_TIMEOUT_MS = 120_000;

/** Estado de la vinculación por deep-link (aa-telegram-chatid-autocaptura, F4). */
type PairingState = "idle" | "requesting" | "polling" | "linked" | "timeout" | "error";

/** Enmascara el chat id mostrando solo los últimos 4 dígitos. */
function maskChatId(chatId: string): string {
  const tail = chatId.slice(-4);
  return `…${tail}`;
}

/**
 * Config de notificaciones al DUEÑO del negocio (F5, design.md §D): a qué chat
 * de Telegram avisar y con qué eventos. Se persiste en
 * AgentDataBackend.notificationConfig — el dispatcher real de envíos es F6;
 * aquí SOLO la configuración.
 *
 * F4 (aa-telegram-chatid-autocaptura): además del campo manual, ofrece
 * vinculación por deep-link (botón → Telegram → polling de estado) para que
 * el dueño no tenga que averiguar su chat_id a mano.
 */
export default function NotificationConfigPanel({ agent, onChange }: { agent: any; onChange: () => void }) {
  const cfg = (agent.dataBackend?.notificationConfig ?? {}) as {
    telegramChatId?: string;
    events?: string[];
  };
  const [chatId, setChatId] = useState(cfg.telegramChatId ?? "");
  const [events, setEvents] = useState<string[]>(cfg.events ?? []);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  // ── Vinculación por deep-link (F4) ──────────────────────────────────────
  // telegramBotConnected: true/false si lo sabemos con fiabilidad (vía
  // /api/channels/:id/status); null si no hay dato fiable — en ese caso NO
  // deshabilitamos el botón, dejamos que el propio POST informe con un 400.
  const [telegramBotConnected, setTelegramBotConnected] = useState<boolean | null>(null);
  const [pairingState, setPairingState] = useState<PairingState>("idle");
  const [pairingLink, setPairingLink] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState("");
  const [linkedChatId, setLinkedChatId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  function clearPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Limpieza al desmontar: nunca dejar el polling corriendo en segundo plano.
  useEffect(() => clearPolling, []);

  // Detección defensiva de si hay bot de Telegram conectado. Reusa el mismo
  // endpoint que ChannelConnectPanel; si falla, se deja en null (desconocido).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{ connections?: { provider: string; status: string }[] }>(
          `/api/channels/${agent.id}/status`
        );
        const conn = data?.connections?.find((c) => c.provider === "telegram");
        if (!cancelled) setTelegramBotConnected(conn?.status === "active");
      } catch {
        if (!cancelled) setTelegramBotConnected(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  function startPolling() {
    clearPolling();
    pollDeadlineRef.current = Date.now() + PAIRING_TIMEOUT_MS;
    pollRef.current = setInterval(async () => {
      if (Date.now() > pollDeadlineRef.current) {
        clearPolling();
        setPairingState("timeout");
        return;
      }
      try {
        const st = await api<{ linked: boolean; chatId?: string }>(
          `/api/agents/${agent.id}/telegram/pairing-status`
        );
        if (st?.linked) {
          clearPolling();
          setLinkedChatId(st.chatId ?? null);
          // Sincroniza también el campo manual: si no, quedaría desfasado y un
          // "Guardar" posterior podría pisar el chatId recién vinculado.
          if (st.chatId) setChatId(st.chatId);
          setPairingState("linked");
          onChange();
        }
      } catch {
        // Fallo puntual de red durante el sondeo: se ignora y se reintenta en
        // el siguiente tick, hasta que venza pollDeadlineRef.
      }
    }, PAIRING_POLL_MS);
  }

  async function startPairing() {
    setPairingError("");
    setPairingState("requesting");
    try {
      const res = await api<{ link: string; expiresAt: string }>(
        `/api/agents/${agent.id}/telegram/pairing-token`,
        { method: "POST" }
      );
      setPairingLink(res?.link ?? null);
      if (res?.link && typeof window !== "undefined") {
        window.open(res.link, "_blank");
      }
      setPairingState("polling");
      startPolling();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 400) {
        setTelegramBotConnected(false);
        setPairingError("Conecta primero el bot de Telegram en la pestaña Canales.");
      } else {
        setPairingError(e?.message ?? "Error al generar el enlace de vinculación.");
      }
      setPairingState("error");
    }
  }

  function retryPairing() {
    setPairingLink(null);
    setPairingError("");
    setPairingState("idle");
  }

  const effectiveLinkedChatId = linkedChatId ?? (pairingState === "idle" ? cfg.telegramChatId : undefined);
  const pairingBusy = pairingState === "requesting" || pairingState === "polling";

  const dirty =
    chatId !== (cfg.telegramChatId ?? "") ||
    JSON.stringify([...events].sort()) !== JSON.stringify([...(cfg.events ?? [])].sort());

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      await api(`/api/agents/${agent.id}/backend`, {
        method: "PATCH",
        body: JSON.stringify({ notificationConfig: { telegramChatId: chatId, events } }),
      });
      setStatus("✓ Guardado");
      onChange();
      setTimeout(() => setStatus(""), 2500);
    } catch (e: any) {
      setStatus(e?.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  if (!agent.dataBackend) return null;

  return (
    <div className="card p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-sm text-white">Notificaciones al dueño del negocio</h3>
        <p className="text-xs text-slate-500 mt-1">
          Destino de los avisos (reservas, leads, escalados). El envío automático se activa en una
          fase posterior; aquí se configura a dónde y con qué eventos.
        </p>
      </div>

      <div className="space-y-2">
        <button
          className="btn-grad text-xs px-4 py-1.5 disabled:opacity-50"
          onClick={startPairing}
          disabled={telegramBotConnected === false || pairingBusy}
        >
          {pairingState === "requesting"
            ? "Generando enlace…"
            : pairingState === "polling"
              ? "Esperando confirmación…"
              : "Vincular mi Telegram"}
        </button>

        {telegramBotConnected === false && (
          <p className="text-xs text-amber-400">
            Conecta primero el bot de Telegram en la pestaña Canales.
          </p>
        )}

        {pairingState === "polling" && (
          <div className="text-xs text-slate-400 space-y-1">
            <p>Te hemos abierto Telegram en una pestaña nueva. Pulsa "Start" en el bot para confirmar.</p>
            {pairingLink && (
              <p>
                Si no se abrió,{" "}
                <a href={pairingLink} target="_blank" rel="noreferrer" className="text-indigo-400 underline">
                  toca aquí para abrir Telegram
                </a>
                .
              </p>
            )}
          </div>
        )}

        {pairingState === "timeout" && (
          <p className="text-xs text-amber-400">
            No detectamos la vinculación.{" "}
            <button type="button" className="underline" onClick={retryPairing}>
              Reintenta
            </button>
            .
          </p>
        )}

        {pairingState === "error" && pairingError && (
          <p className="text-xs text-red-400">{pairingError}</p>
        )}

        {effectiveLinkedChatId && (
          <p className="text-xs text-emerald-400">
            ✅ Vinculado — recibirás las notificaciones en este Telegram (chat {maskChatId(effectiveLinkedChatId)}).
          </p>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="text-xs text-indigo-400 hover:text-indigo-300 underline"
        >
          {manualOpen ? "Ocultar entrada manual" : "¿Prefieres pegarlo a mano?"}
        </button>
        {manualOpen && (
          <div className="mt-2">
            <label className="text-xs text-slate-400 block mb-1">Chat ID de Telegram del dueño</label>
            <input
              className="input-dark w-full text-xs"
              placeholder="p.ej. 123456789"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-xs text-slate-400 block">Eventos</label>
        <div className="flex gap-4 flex-wrap">
          {EVENTS.map((ev) => (
            <label key={ev.id} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={events.includes(ev.id)}
                onChange={(e) =>
                  setEvents((prev) =>
                    e.target.checked ? [...prev, ev.id] : prev.filter((x) => x !== ev.id)
                  )
                }
              />
              {ev.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button className="btn-grad text-xs px-4 py-1.5 disabled:opacity-50" onClick={save} disabled={saving || !dirty}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {status && <span className="text-xs text-emerald-400">{status}</span>}
      </div>
    </div>
  );
}
