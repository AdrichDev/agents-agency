"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useDialogs } from "@/components/ui/ConfirmProvider";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ConnectionInfo {
  provider: string;
  status: string;
  statusDetail?: string;
  botUsername?: string;
  botName?: string;
  phoneNumberIdMasked?: string;
  webhookUrl?: string;
}

interface StatusResponse {
  publicUrlConfigured: boolean;
  connections: ConnectionInfo[];
}

type ChannelStatus = "loading" | "disconnected" | "pending" | "active" | "error";

interface PanelState {
  status: ChannelStatus;
  connection?: ConnectionInfo;
  publicUrlConfigured: boolean;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ChannelConnectPanelProps {
  agentId: string;
  channel: "telegram" | "whatsapp";
  onChange: () => void;
}

// ── Instrucciones paso a paso (colapsables) ───────────────────────────────────

function TelegramInstructions() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-indigo-400 hover:text-indigo-300 underline"
      >
        {open ? "Ocultar instrucciones" : "¿Cómo obtener el token?"}
      </button>
      {open && (
        <ol className="mt-2 space-y-1 text-xs text-slate-400 list-decimal list-inside">
          <li>Abre Telegram y busca <strong className="text-slate-300">@BotFather</strong>.</li>
          <li>Envía el comando <code className="bg-slate-800 px-1 rounded">/newbot</code>.</li>
          <li>Sigue las instrucciones: elige nombre y username para el bot.</li>
          <li>BotFather te enviará el token con el formato <code className="bg-slate-800 px-1 rounded">123456:ABC-DEF...</code></li>
          <li>Copia ese token y pégalo arriba.</li>
        </ol>
      )}
    </div>
  );
}

function WhatsAppInstructions({ webhookUrl }: { webhookUrl?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-indigo-400 hover:text-indigo-300 underline"
      >
        {open ? "Ocultar instrucciones" : "¿Cómo configurar el webhook en Meta?"}
      </button>
      {open && (
        <ol className="mt-2 space-y-1 text-xs text-slate-400 list-decimal list-inside">
          <li>Ve a <strong className="text-slate-300">Meta for Developers</strong> → tu app → WhatsApp → Configuration.</li>
          <li>En <em>Webhook</em>, haz clic en <strong>Edit</strong>.</li>
          <li>
            En <em>Callback URL</em> pega:{" "}
            {webhookUrl ? (
              <code className="bg-slate-800 px-1 rounded break-all">{webhookUrl}</code>
            ) : (
              <span className="text-yellow-400">(configura PUBLIC_URL en el backend primero)</span>
            )}
          </li>
          <li>En <em>Verify Token</em> introduce el mismo valor que pusiste en el campo "Verify Token" arriba.</li>
          <li>Haz clic en <strong>Verify and Save</strong>. Meta llamará al backend; el estado cambiará a "Conectado".</li>
          <li>Suscríbete al campo <code className="bg-slate-800 px-1 rounded">messages</code> en la sección Webhook fields.</li>
        </ol>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ChannelConnectPanel({
  agentId,
  channel,
  onChange,
}: ChannelConnectPanelProps) {
  const { confirm } = useDialogs();
  const [panelState, setPanelState] = useState<PanelState>({
    status: "loading",
    publicUrlConfigured: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Campos del formulario
  const [token, setToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [verifyToken, setVerifyToken] = useState("");

  const label = channel === "telegram" ? "Telegram" : "WhatsApp";

  async function loadStatus() {
    setPanelState((s) => ({ ...s, status: "loading" }));
    try {
      const data: StatusResponse = await api(`/api/channels/${agentId}/status`);
      const conn = data.connections.find((c) => c.provider === channel);
      setPanelState({
        publicUrlConfigured: data.publicUrlConfigured,
        status: (conn?.status as ChannelStatus) ?? "disconnected",
        connection: conn,
      });
    } catch {
      setPanelState({ status: "disconnected", publicUrlConfigured: true });
    }
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, channel]);

  async function handleConnect() {
    setSubmitting(true);
    setError(null);
    try {
      let body: object;
      if (channel === "telegram") {
        body = { agentId, token };
      } else {
        body = { agentId, phoneNumberId, accessToken, verifyToken };
      }
      const res = await api<any>(`/api/channels/${channel}/connect`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.error) {
        setError(res.error);
      } else {
        await loadStatus();
        onChange();
      }
    } catch {
      setError("Error de red al conectar el canal.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisconnect() {
    const ok = await confirm({
      title: "Desconectar canal",
      message: `¿Desconectar el bot de ${label}? Esta acción revocará el webhook.`,
      confirmText: "Desconectar",
      danger: true,
    });
    if (!ok) return;
    setSubmitting(true);
    setError(null);
    try {
      await api(`/api/channels/${channel}/${agentId}`, { method: "DELETE" });
      await loadStatus();
      onChange();
    } catch {
      setError("Error al desconectar.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Renderizado ──

  if (panelState.status === "loading") {
    return (
      <div className="card p-5">
        <p className="text-sm text-slate-500">Cargando estado de {label}…</p>
      </div>
    );
  }

  const { status, connection, publicUrlConfigured } = panelState;

  return (
    <div className="card p-5 space-y-4">
      {/* Cabecera */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-white flex items-center gap-2">
          {channel === "telegram" ? (
            <span className="text-blue-400">✈</span>
          ) : (
            <span className="text-green-400">●</span>
          )}
          {label}
        </h3>
        {status === "active" && (
          <span className="chip text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-700/40 px-2 py-0.5 rounded-full">
            Conectado
          </span>
        )}
        {status === "pending" && (
          <span className="chip text-xs bg-yellow-900/40 text-yellow-400 border border-yellow-700/40 px-2 py-0.5 rounded-full">
            Pendiente de verificación
          </span>
        )}
        {status === "error" && (
          <span className="chip text-xs bg-red-900/40 text-red-400 border border-red-700/40 px-2 py-0.5 rounded-full">
            Error de conexión
          </span>
        )}
        {status === "disconnected" && (
          <span className="chip text-xs bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full">
            Desconectado
          </span>
        )}
      </div>

      {/* Aviso PUBLIC_URL no configurada */}
      {!publicUrlConfigured && (
        <div className="rounded-lg bg-yellow-900/30 border border-yellow-700/40 p-3 text-xs text-yellow-300">
          El backend no tiene <code>PUBLIC_URL</code> configurada. El bot no podrá recibir mensajes
          hasta que se configure un dominio HTTPS público (p. ej. con ngrok o en producción).
        </div>
      )}

      {/* Estado activo */}
      {status === "active" && connection && (
        <div className="space-y-2">
          {channel === "telegram" && connection.botUsername && (
            <p className="text-sm text-slate-300">
              Bot: <span className="text-white font-medium">@{connection.botUsername}</span>
              {connection.botName && (
                <span className="text-slate-500 ml-1">({connection.botName})</span>
              )}
            </p>
          )}
          {channel === "whatsapp" && connection.phoneNumberIdMasked && (
            <p className="text-sm text-slate-300">
              Phone Number ID: <span className="text-white font-medium">{connection.phoneNumberIdMasked}</span>
            </p>
          )}
          <button
            onClick={handleDisconnect}
            disabled={submitting}
            className="btn-danger text-xs px-3 py-1.5"
          >
            {submitting ? "Desconectando…" : "Desconectar"}
          </button>
        </div>
      )}

      {/* Estado pendiente (WhatsApp) */}
      {status === "pending" && channel === "whatsapp" && connection && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            Registra esta URL como webhook en Meta Developer Console para activar la conexión:
          </p>
          {connection.webhookUrl && (
            <div className="flex items-center gap-2">
              <code className="text-xs bg-slate-800 px-2 py-1 rounded text-slate-200 break-all flex-1">
                {connection.webhookUrl}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(connection.webhookUrl!)}
                className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0"
              >
                Copiar
              </button>
            </div>
          )}
          <WhatsAppInstructions webhookUrl={connection.webhookUrl} />
          <button
            onClick={handleDisconnect}
            disabled={submitting}
            className="btn-danger text-xs px-3 py-1.5 mt-2"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Estado error o desconectado — mostrar formulario */}
      {(status === "disconnected" || status === "error") && (
        <div className="space-y-3">
          {status === "error" && connection?.statusDetail && (
            <p className="text-xs text-red-400">Error: {connection.statusDetail}</p>
          )}

          {channel === "telegram" ? (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Token de BotFather</label>
                <input
                  className="input-dark w-full text-sm"
                  type="password"
                  placeholder="123456:ABC-DEF..."
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <TelegramInstructions />
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Phone Number ID</label>
                <input
                  className="input-dark w-full text-sm"
                  placeholder="10987654321"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Access Token</label>
                <input
                  className="input-dark w-full text-sm"
                  type="password"
                  placeholder="EAAG..."
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Verify Token</label>
                <input
                  className="input-dark w-full text-sm"
                  placeholder="mi-token-secreto"
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  disabled={submitting}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Cadena que tú defines y luego introduces en Meta Developer Console.
                </p>
              </div>
              <WhatsAppInstructions />
            </>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleConnect}
            disabled={
              submitting ||
              !publicUrlConfigured ||
              (channel === "telegram" ? !token : !phoneNumberId || !accessToken || !verifyToken)
            }
            className="btn-grad text-sm px-4 py-2 disabled:opacity-50"
          >
            {submitting ? "Conectando…" : "Conectar"}
          </button>
        </div>
      )}
    </div>
  );
}
