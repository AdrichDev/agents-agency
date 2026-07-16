"use client";

import { useEffect, useState } from "react";
import { API, api } from "@/lib/api";

const PALETTE = ["#4f46e5", "#9333ea", "#0f766e", "#dc2626", "#f59e0b", "#111827"];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Estado de conexión de canales (Telegram / WhatsApp) ──────────────────────
interface ConnectionInfo {
  provider: string;
  status: string;
  botUsername?: string;
  botName?: string;
  phoneNumberIdMasked?: string;
}
interface StatusResponse {
  publicUrlConfigured: boolean;
  connections: ConnectionInfo[];
}

/** Fecha relativa breve en español (para "último visto" del ping del widget). */
function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "hace instantes";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} d`;
  return new Date(iso).toLocaleDateString("es-ES");
}

// Píldora de estado reutilizable (verde = listo, ámbar = pendiente).
function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
        ok
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
          : "border-amber-400/40 bg-amber-400/10 text-amber-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
      {label}
    </span>
  );
}

// "Lo hace el cliente" vs "Lo hace la agencia" — deja claro quién implementa cada canal.
function OwnerTag({ who }: { who: "cliente" | "agencia" }) {
  return (
    <span className="rounded-full border border-edge bg-black/30 px-2 py-0.5 text-[11px] text-slate-400">
      {who === "cliente" ? "Lo instala el cliente" : "La conecta la agencia"}
    </span>
  );
}

export default function DeployPanel({ agent, onChange }: { agent: any; onChange: () => void }) {
  const [copied, setCopied] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [channels, setChannels] = useState<StatusResponse | null>(null);
  const [config, setConfig] = useState({
    widgetPrimaryColor: agent.widgetPrimaryColor ?? "#4f46e5",
    widgetSecondaryColor: agent.widgetSecondaryColor ?? "#9333ea",
    widgetAvatarEmoji: agent.widgetAvatarEmoji ?? "🤖",
    widgetAvatarBase64: agent.widgetAvatarBase64 ?? "",
    widgetTemplateConfig: {
      position: agent.widgetTemplateConfig?.position ?? "right",
      launcherShape: agent.widgetTemplateConfig?.launcherShape ?? "circle",
      panelSize: agent.widgetTemplateConfig?.panelSize ?? "normal",
    },
  });
  // Solo enviamos el avatar si el usuario lo cambió: un agente migrado tiene
  // base64="" (la imagen vive en Storage como URL) → enviar "" lo borraría.
  const [avatarTouched, setAvatarTouched] = useState(false);

  // Estado real de conexión de Telegram/WhatsApp (no "próximamente"): lo lee del
  // mismo endpoint que el panel de Canales. Best-effort: si falla, se muestran
  // como pendientes en vez de romper la vista.
  async function loadChannels() {
    try {
      const data = await api<StatusResponse>(`/api/channels/${agent.id}/status`);
      setChannels(data);
    } catch {
      setChannels({ publicUrlConfigured: false, connections: [] });
    }
  }
  useEffect(() => {
    void loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const snippet = `<script src="${API}/widget.js" data-agent-key="${agent.publicKey}"></script>`;
  const curl = `curl -X POST ${API}/api/chat \\
  -H "Content-Type: application/json" \\
  -d '{"publicKey": "${agent.publicKey}", "message": "Hola"}'`;

  function copy(text: string, which: string) {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(""), 1500);
  }

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const payload: any = {
        widgetPrimaryColor: config.widgetPrimaryColor,
        widgetSecondaryColor: config.widgetSecondaryColor,
        widgetAvatarEmoji: config.widgetAvatarEmoji,
        widgetTemplateConfig: config.widgetTemplateConfig,
      };
      if (avatarTouched) payload.widgetAvatarBase64 = config.widgetAvatarBase64 || null;
      await api(`/api/agents/${agent.id}/widget-config`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setStatus("Configuración guardada");
      onChange();
    } catch {
      setStatus("No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function setImage(file?: File) {
    if (!file) return;
    if (file.size > 300_000) {
      setStatus("Imagen demasiado grande (máx. 300 KB) — usa una más pequeña");
      return;
    }
    const widgetAvatarBase64 = await fileToBase64(file);
    setConfig((current) => ({ ...current, widgetAvatarBase64 }));
    setAvatarTouched(true);
  }

  // Re-comprueba el estado (recarga el detalle del agente → badge de instalación
  // del widget) y el estado de los canales.
  async function recheck() {
    if (checking) return;
    setChecking(true);
    try {
      await Promise.all([Promise.resolve(onChange()), loadChannels()]);
    } finally {
      setChecking(false);
    }
  }

  const widgetInstalled = Boolean(agent.widgetInstalledAt);
  const connByProvider = (p: string) => channels?.connections.find((c) => c.provider === p);
  const tg = connByProvider("telegram");
  const wa = connByProvider("whatsapp");
  const tgActive = tg?.status === "active";
  const waActive = wa?.status === "active" || wa?.status === "pending"; // WA queda "pending" tras conectar (verify de Meta)

  return (
    <div className="space-y-5">
      <div className="card p-5 border-[var(--neon-purple)]/40">
        <div className="kicker mb-1">Implementación / entrega</div>
        <h3 className="font-semibold text-sm text-white mb-1">Pon el agente a funcionar en cada canal</h3>
        <p className="text-xs text-slate-500">
          Sigue el checklist por canal. El <strong className="text-slate-300">widget</strong> y la{" "}
          <strong className="text-slate-300">API</strong> los instala el cliente (copiar y pegar); los canales de{" "}
          <strong className="text-slate-300">mensajería</strong> (Telegram / WhatsApp) los conecta la agencia desde
          «Canales e integraciones».
        </p>
        <button
          onClick={recheck}
          disabled={checking}
          className="mt-3 rounded-full border border-edge px-3 py-1.5 text-xs text-slate-300 hover:text-white disabled:opacity-60"
        >
          {checking ? "Comprobando…" : "Comprobar estado ⟳"}
        </button>
      </div>

      {/* ── Widget web ─────────────────────────────────────────────────────── */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-white">Widget web (chatbot embebido)</h3>
          <div className="flex items-center gap-2">
            <OwnerTag who="cliente" />
            <StatusPill
              ok={widgetInstalled}
              label={
                widgetInstalled
                  ? `Instalado ✓ · visto ${relativeTime(agent.widgetLastSeenAt)}`
                  : "Pendiente de instalación"
              }
            />
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Pega este snippet antes de <code className="bg-black/40 px-1 rounded">{"</body>"}</code> en la web del
          cliente. Aparece una burbuja de chat flotante.
        </p>
        <pre className="bg-black/50 border border-edge text-slate-300 text-xs p-4 rounded-xl overflow-x-auto">{snippet}</pre>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => copy(snippet, "widget")} className="btn-grad !px-3 !py-1.5 !text-xs">
            {copied === "widget" ? "Copiado" : "Copiar snippet"}
          </button>
          <button
            onClick={() => setGuideOpen((v) => !v)}
            className="text-xs text-indigo-400 hover:text-indigo-300 underline"
          >
            {guideOpen ? "Ocultar guía de instalación" : "¿Cómo lo instala el cliente?"}
          </button>
        </div>
        {guideOpen && (
          <ol className="mt-1 space-y-1.5 text-xs text-slate-400 list-decimal list-inside">
            <li>Copia el snippet de arriba.</li>
            <li>
              Pégalo justo antes de <code className="bg-black/40 px-1 rounded">{"</body>"}</code> en el HTML de la web
              (o en el bloque de «código personalizado / footer» del gestor: WordPress, Shopify, Wix, etc.).
            </li>
            <li>Publica los cambios y recarga la página del sitio.</li>
            <li>Aparecerá la burbuja de chat. Al cargarse, esta ficha pasa sola a «Instalado ✓».</li>
          </ol>
        )}
        {!widgetInstalled && (
          <p className="text-[11px] text-slate-500">
            Aún no hemos recibido ninguna carga del widget. Si ya lo pegaste, abre la web del cliente y pulsa
            «Comprobar estado».
          </p>
        )}
      </div>

      {/* ── Configuración visual del widget (consolidada aquí) ─────────────── */}
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-sm text-white">Apariencia del widget</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(["widgetPrimaryColor", "widgetSecondaryColor"] as const).map((key) => (
            <label key={key} className="text-xs text-slate-500">
              {key === "widgetPrimaryColor" ? "Color primario" : "Color secundario"}
              <div className="flex gap-2 mt-1">
                <input
                  className="input-dark"
                  value={config[key]}
                  onChange={(e) => setConfig((current) => ({ ...current, [key]: e.target.value }))}
                />
                <input
                  type="color"
                  value={config[key].startsWith("#") ? config[key] : "#4f46e5"}
                  onChange={(e) => setConfig((current) => ({ ...current, [key]: e.target.value }))}
                  className="h-10 w-12 rounded bg-transparent"
                />
              </div>
            </label>
          ))}
        </div>
        <div className="space-y-2">
          {(["widgetPrimaryColor", "widgetSecondaryColor"] as const).map((key) => (
            <div key={key} className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500 w-24">
                {key === "widgetPrimaryColor" ? "Paleta 1º" : "Paleta 2º"}
              </span>
              {PALETTE.map((color) => (
                <button
                  key={color}
                  title={color}
                  onClick={() => setConfig((current) => ({ ...current, [key]: color }))}
                  className={`h-7 w-7 rounded-full border transition ${
                    config[key] === color ? "border-white scale-110" : "border-white/20"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            className="input-dark"
            value={config.widgetAvatarEmoji}
            onChange={(e) => setConfig((current) => ({ ...current, widgetAvatarEmoji: e.target.value }))}
          />
          <select
            className="input-dark"
            value={config.widgetTemplateConfig.position}
            onChange={(e) =>
              setConfig((current) => ({
                ...current,
                widgetTemplateConfig: { ...current.widgetTemplateConfig, position: e.target.value },
              }))
            }
          >
            <option value="right">Derecha</option>
            <option value="left">Izquierda</option>
          </select>
          <select
            className="input-dark"
            value={config.widgetTemplateConfig.launcherShape}
            onChange={(e) =>
              setConfig((current) => ({
                ...current,
                widgetTemplateConfig: { ...current.widgetTemplateConfig, launcherShape: e.target.value },
              }))
            }
          >
            <option value="circle">Circular</option>
            <option value="rounded">Redondeado</option>
          </select>
          <select
            className="input-dark"
            value={config.widgetTemplateConfig.panelSize}
            onChange={(e) =>
              setConfig((current) => ({
                ...current,
                widgetTemplateConfig: { ...current.widgetTemplateConfig, panelSize: e.target.value },
              }))
            }
          >
            <option value="compact">Compacto</option>
            <option value="normal">Normal</option>
            <option value="wide">Ancho</option>
          </select>
        </div>
        <input className="input-dark" type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0])} />
        {(config.widgetAvatarBase64 || agent.widgetAvatarUrl) && (
          <img src={config.widgetAvatarBase64 || agent.widgetAvatarUrl} alt="Avatar widget" className="h-14 w-14 rounded-full object-cover" />
        )}
        <button onClick={save} disabled={saving} className="btn-grad !px-3 !py-1.5 !text-xs">
          {saving ? "Guardando..." : "Guardar apariencia"}
        </button>
        {status && <p className="text-xs text-slate-400">{status}</p>}
      </div>

      {/* ── API REST ───────────────────────────────────────────────────────── */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-white">API REST (integración programática)</h3>
          <OwnerTag who="cliente" />
        </div>
        <p className="text-xs text-slate-500">
          Llama al agente desde cualquier backend, app web o móvil con la clave pública del agente.
        </p>
        <pre className="bg-black/50 border border-edge text-slate-300 text-xs p-4 rounded-xl overflow-x-auto">{curl}</pre>
        <button onClick={() => copy(curl, "api")} className="btn-grad !px-3 !py-1.5 !text-xs">
          {copied === "api" ? "Copiado" : "Copiar ejemplo"}
        </button>
      </div>

      {/* ── Telegram ───────────────────────────────────────────────────────── */}
      <div className="card p-5 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-white">Telegram (bot de mensajería)</h3>
          <div className="flex items-center gap-2">
            <OwnerTag who="agencia" />
            <StatusPill
              ok={tgActive}
              label={tgActive ? `Conectado${tg?.botUsername ? ` · @${tg.botUsername}` : ""}` : "Pendiente de conexión"}
            />
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {tgActive
            ? "El bot está activo y recibe mensajes. No hay nada más que hacer en el sitio del cliente."
            : "La agencia conecta el bot con un token de @BotFather desde la pestaña «Canales e integraciones». Una vez conectado, aquí figurará como activo."}
        </p>
      </div>

      {/* ── WhatsApp ───────────────────────────────────────────────────────── */}
      <div className="card p-5 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-white">WhatsApp (bot de mensajería)</h3>
          <div className="flex items-center gap-2">
            <OwnerTag who="agencia" />
            <StatusPill ok={waActive} label={waActive ? "Conectado" : "Pendiente de conexión"} />
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {waActive
            ? "El número está vinculado vía Meta Cloud API y recibe mensajes."
            : "La agencia conecta el número con credenciales de Meta Cloud API (phone number ID y access token) desde «Canales e integraciones»."}
        </p>
      </div>
    </div>
  );
}
