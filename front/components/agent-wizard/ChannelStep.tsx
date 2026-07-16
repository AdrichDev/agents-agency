import type { AgentWizardForm } from "@/components/agent-wizard/types";

/**
 * Paso de canal SIMPLIFICADO (aa-openclaw-provision-hardening): solo la
 * elección del canal de despliegue. Toda la personalización visual del widget
 * (colores, avatar, forma, posición) vive en la ficha del agente (pestaña
 * Deploy), donde ya era editable — el wizard aplica valores por defecto
 * sensatos y deja de duplicar ese formulario aquí.
 */
interface ChannelOption {
  value: string;
  title: string;
  desc: string;
  /** "api" no es un canal de mensajería que conectar: no tiene par en este picker. */
  standalone?: boolean;
}

const CHANNEL_OPTIONS: ChannelOption[] = [
  {
    value: "widget",
    title: "Widget web (chatbot embebido)",
    desc: "Chat interactivo flotante para la web del cliente. Sirve para atender usuarios y captar leads automáticamente.",
  },
  {
    value: "telegram",
    title: "Telegram (bot de mensajería)",
    desc: "Bot con webhook. Sirve para atender a tus clientes directamente dentro de su aplicación de mensajería.",
  },
  {
    value: "whatsapp",
    title: "WhatsApp (bot de mensajería)",
    desc: "WhatsApp Business API. Sirve para automatizar el soporte y ventas en el canal de chat más utilizado.",
  },
  {
    value: "api",
    title: "Solo API (sin canal de mensajería)",
    desc: "El agente se integra directamente en tu backend, apps o sistemas propios vía API REST con su publicKey. No requiere conectar nada.",
    standalone: true,
  },
];

export default function ChannelStep({
  form,
  set,
}: {
  form: AgentWizardForm;
  set: <K extends keyof AgentWizardForm>(key: K, value: AgentWizardForm[K]) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold text-white mb-5">Canal de despliegue</h2>
        <p className="text-xs text-slate-500 mb-4">
          Elige dónde vivirá el agente. Esto define el tipo de producto que se generará al final del wizard.
          El agente además queda siempre disponible vía API REST, se elija el canal que se elija.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {CHANNEL_OPTIONS.map(({ value, title, desc, standalone }) => (
            <button
              key={value}
              onClick={() => set("channel", value)}
              className={`rounded-xl p-4 text-left border transition ${
                form.channel === value
                  ? "border-[var(--neon-purple)] bg-[var(--neon-purple)]/15"
                  : "border-edge hover:border-[var(--neon-purple)]/50 hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="font-medium text-sm text-slate-200">{title}</div>
                {standalone && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-400 shrink-0">
                    sin conexión
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 mt-1">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {form.channel === "widget" && (
        <p className="text-xs text-slate-500 rounded-xl border border-edge bg-white/5 p-3">
          🎨 La apariencia del widget (colores, avatar, posición…) se personaliza después, en la
          ficha del agente — pestaña <span className="text-slate-300">Deploy</span>. De momento se
          aplican los valores por defecto.
        </p>
      )}
    </div>
  );
}
