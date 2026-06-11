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
        <h2 className="font-semibold text-white mb-5">Paso 5 - Canal de despliegue</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            ["widget", "Widget web", "Snippet para la web del cliente"],
            ["api", "API", "Endpoint REST para integraciones"],
            ["telegram", "Telegram", "Bot con webhook"],
            ["whatsapp", "WhatsApp", "WhatsApp Business API"],
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
          <input
            className="input-dark"
            value={form.widgetAvatarEmoji}
            onChange={(e) => set("widgetAvatarEmoji", e.target.value)}
            placeholder="🤖"
          />
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
          <input
            className="input-dark"
            type="file"
            accept="image/*"
            onChange={(e) => setImage(e.target.files?.[0])}
          />
        </div>
        {form.widgetAvatarBase64 && (
          <img src={form.widgetAvatarBase64} alt="Avatar widget" className="h-14 w-14 rounded-full object-cover" />
        )}
      </div>
    </div>
  );
}
