import { useState } from "react";
import type { AgentWizardForm, WidgetTemplateConfig } from "@/components/agent-wizard/types";

const PALETTE = ["#4f46e5", "#9333ea", "#0f766e", "#dc2626", "#f59e0b", "#111827"];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ChannelStep({
  form,
  set,
}: {
  form: AgentWizardForm;
  set: <K extends keyof AgentWizardForm>(key: K, value: AgentWizardForm[K]) => void;
}) {
  const [showEmojiModal, setShowEmojiModal] = useState(false);
  function setTemplate<K extends keyof WidgetTemplateConfig>(key: K, value: WidgetTemplateConfig[K]) {
    set("widgetTemplateConfig", { ...form.widgetTemplateConfig, [key]: value });
  }

  async function setImage(file?: File) {
    if (!file) return;
    set("widgetAvatarBase64", await fileToBase64(file));
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold text-white mb-5">Paso 3 - Canal de despliegue</h2>
        <p className="text-xs text-slate-500 mb-4">
          Elige dónde vivirá el agente. Esto define el tipo de producto que se generará al final del wizard.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            ["widget", "Widget web (chatbot embebido)", "Chat interactivo flotante para la web del cliente. Sirve para atender usuarios y captar leads automáticamente."],
            ["api", "API (agente programático)", "Endpoint REST para conectar tu backend, apps o sistemas propios. Sirve para enviar y recibir mensajes programáticos."],
            ["telegram", "Telegram (bot de mensajería)", "Bot con webhook. Sirve para atender a tus clientes directamente dentro de su aplicación de mensajería."],
            ["whatsapp", "WhatsApp (bot de mensajería)", "WhatsApp Business API. Sirve para automatizar el soporte y ventas en el canal de chat más utilizado."],
          ].map(([value, title, desc]) => (
            <button
              key={value}
              onClick={() => set("channel", value)}
              className={`rounded-xl p-4 text-left border transition ${
                form.channel === value
                  ? "border-[var(--neon-purple)] bg-[var(--neon-purple)]/15"
                  : "border-edge hover:border-[var(--neon-purple)]/50 hover:bg-white/5"
              }`}
            >
              <div className="font-medium text-sm text-slate-200">{title}</div>
              <div className="text-xs text-slate-500 mt-1">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {form.channel === "widget" && (
      <div className="card !rounded-xl p-4 space-y-4 bg-white/5">
        <h3 className="font-semibold text-sm text-white">Plantilla del widget</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs text-slate-500">
            Color primario
            <div className="flex gap-2 mt-1">
              <input
                className="input-dark"
                value={form.widgetPrimaryColor}
                onChange={(e) => set("widgetPrimaryColor", e.target.value)}
              />
              <input
                type="color"
                value={form.widgetPrimaryColor.startsWith("#") ? form.widgetPrimaryColor : "#4f46e5"}
                onChange={(e) => set("widgetPrimaryColor", e.target.value)}
                className="h-10 w-12 rounded bg-transparent"
              />
            </div>
          </label>
          <label className="text-xs text-slate-500">
            Color secundario
            <div className="flex gap-2 mt-1">
              <input
                className="input-dark"
                value={form.widgetSecondaryColor}
                onChange={(e) => set("widgetSecondaryColor", e.target.value)}
              />
              <input
                type="color"
                value={form.widgetSecondaryColor.startsWith("#") ? form.widgetSecondaryColor : "#9333ea"}
                onChange={(e) => set("widgetSecondaryColor", e.target.value)}
                className="h-10 w-12 rounded bg-transparent"
              />
            </div>
          </label>
        </div>
        <div className="flex gap-2 flex-wrap">
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              title={color}
              onClick={() => set("widgetPrimaryColor", color)}
              className="h-7 w-7 rounded-full border border-white/20"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative flex gap-2">
            <input
              className="input-dark flex-1"
              value={form.widgetAvatarEmoji}
              onChange={(e) => set("widgetAvatarEmoji", e.target.value)}
              placeholder="🤖"
            />
            <button
              type="button"
              onClick={() => setShowEmojiModal(!showEmojiModal)}
              className="btn-dark !px-3 bg-transparent hover:bg-white/5"
              title="Buscar emoji"
            >
              🔍
            </button>
            {showEmojiModal && (
              <div className="absolute right-0 top-12 z-50 card p-3 grid grid-cols-6 gap-2 w-48 shadow-xl bg-panel border border-edge">
                {["🤖", "👤", "💬", "⚡", "🧠", "🦸", "🦁", "👽", "😺", "🧙", "🚀", "🧑‍💻", "🐶", "🦉", "🔥", "🌈", "👾", "🎨"].map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => {
                      set("widgetAvatarEmoji", em);
                      setShowEmojiModal(false);
                    }}
                    className="text-lg hover:bg-white/10 p-1 rounded transition"
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>
          <select
            className="input-dark"
            value={form.widgetTemplateConfig.position}
            onChange={(e) => setTemplate("position", e.target.value as WidgetTemplateConfig["position"])}
          >
            <option value="right">Derecha</option>
            <option value="left">Izquierda</option>
          </select>
          <select
            className="input-dark"
            value={form.widgetTemplateConfig.panelSize}
            onChange={(e) => setTemplate("panelSize", e.target.value as WidgetTemplateConfig["panelSize"])}
          >
            <option value="compact">Compacto</option>
            <option value="normal">Normal</option>
            <option value="wide">Ancho</option>
          </select>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            className="input-dark"
            value={form.widgetTemplateConfig.launcherShape}
            onChange={(e) =>
              setTemplate("launcherShape", e.target.value as WidgetTemplateConfig["launcherShape"])
            }
          >
            <option value="circle">Circular</option>
            <option value="rounded">Redondeado</option>
          </select>
          <div className="flex items-center gap-2 w-full">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImage(e.target.files?.[0])}
              className="hidden"
              id="wizard-avatar-upload"
            />
            <label
              htmlFor="wizard-avatar-upload"
              className="btn-dark cursor-pointer text-center py-2 px-3 text-xs flex items-center justify-center gap-2 bg-transparent hover:bg-white/5 border border-edge rounded-xl w-full"
            >
              📸 {form.widgetAvatarBase64 ? "Cambiar foto" : "Subir foto"}
            </label>
            {form.widgetAvatarBase64 && (
              <button
                type="button"
                onClick={() => set("widgetAvatarBase64", "")}
                className="text-[10px] text-rose-400 hover:underline shrink-0"
              >
                Eliminar
              </button>
            )}
          </div>
        </div>
        {form.widgetAvatarBase64 && (
          <img src={form.widgetAvatarBase64} alt="Avatar widget" className="h-14 w-14 rounded-full object-cover" />
        )}
      </div>
      )}
    </div>
  );
}
