"use client";

import { useState } from "react";
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

const CHANNEL_INFO: Record<string, { title: string; description: string }> = {
  widget: {
    title: "Widget web (chatbot embebido en la web del cliente)",
    description:
      "Se ha generado un chatbot flotante listo para insertar en la web del cliente. Atiende visitas y capta leads automáticamente.",
  },
  api: {
    title: "API REST (agente programático)",
    description:
      "Se ha generado un endpoint REST para integrar el agente en tu backend, apps web o móviles.",
  },
  telegram: {
    title: "Telegram (bot de mensajería)",
    description:
      "Este agente se desplegará como bot de Telegram. La conexión guiada con BotFather estará disponible próximamente.",
  },
  whatsapp: {
    title: "WhatsApp (bot de mensajería)",
    description:
      "Este agente se desplegará en WhatsApp Business API. La conexión guiada con Meta Cloud API estará disponible próximamente.",
  },
};

export default function DeployPanel({ agent, onChange }: { agent: any; onChange: () => void }) {
  const [copied, setCopied] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
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

  const channel = agent.channel ?? "widget";
  const info = CHANNEL_INFO[channel] ?? CHANNEL_INFO.widget;

  return (
    <div className="space-y-5">
      <div className="card p-5 border-[var(--neon-purple)]/40">
        <div className="kicker mb-1">Tipo de agente generado</div>
        <h3 className="font-semibold text-sm text-white mb-1">{info.title}</h3>
        <p className="text-xs text-slate-500">{info.description}</p>
      </div>

      {channel === "widget" && (
      <div className="card p-5">
        <h3 className="font-semibold text-sm text-white mb-1">Widget para la web del cliente (el chatbot)</h3>
        <p className="text-xs text-slate-500 mb-3">
          Pega esto antes de {"</body>"} en la web del cliente. Aparece una burbuja de chat.
        </p>
        <pre className="bg-black/50 border border-edge text-slate-300 text-xs p-4 rounded-xl overflow-x-auto">{snippet}</pre>
        <button onClick={() => copy(snippet, "widget")} className="mt-3 btn-grad !px-3 !py-1.5 !text-xs">
          {copied === "widget" ? "Copiado" : "Copiar snippet"}
        </button>
      </div>
      )}

      {channel === "widget" && (
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-sm text-white">Configuración visual</h3>
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
          {saving ? "Guardando..." : "Guardar configuración"}
        </button>
        {status && <p className="text-xs text-slate-400">{status}</p>}
      </div>
      )}

      {channel === "api" && (
      <div className="card p-5">
        <h3 className="font-semibold text-sm text-white mb-1">API REST (cómo llamar al agente)</h3>
        <p className="text-xs text-slate-500 mb-3">
          Ejemplo de petición. Usa la clave pública del agente desde cualquier backend o app.
        </p>
        <pre className="bg-black/50 border border-edge text-slate-300 text-xs p-4 rounded-xl overflow-x-auto">{curl}</pre>
        <button onClick={() => copy(curl, "api")} className="mt-3 btn-grad !px-3 !py-1.5 !text-xs">
          {copied === "api" ? "Copiado" : "Copiar ejemplo"}
        </button>
      </div>
      )}

      {(channel === "telegram" || channel === "whatsapp") && (
      <div className="card p-5 text-sm text-slate-400 space-y-2">
        <h3 className="font-semibold text-sm text-white">
          {channel === "telegram" ? "Bot de Telegram" : "Bot de WhatsApp"}
        </h3>
        <p className="text-xs">
          {channel === "telegram"
            ? "Para activarlo necesitarás un token de @BotFather. La conexión guiada se configurará desde Integraciones."
            : "Para activarlo necesitarás credenciales de Meta Cloud API (phone number ID y access token). La conexión guiada se configurará desde Integraciones."}
        </p>
      </div>
      )}
    </div>
  );
}
