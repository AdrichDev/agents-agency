import type { AgentWizardForm } from "@/components/agent-wizard/types";

/**
 * Paso de canal SIMPLIFICADO (aa-openclaw-provision-hardening): solo la
 * elección del canal de despliegue. Toda la personalización visual del widget
 * (colores, avatar, forma, posición) vive en la ficha del agente (pestaña
 * Deploy), donde ya era editable — el wizard aplica valores por defecto
 * sensatos y deja de duplicar ese formulario aquí.
 */
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
        <p className="text-xs text-slate-500 rounded-xl border border-edge bg-white/5 p-3">
          🎨 La apariencia del widget (colores, avatar, posición…) se personaliza después, en la
          ficha del agente — pestaña <span className="text-slate-300">Deploy</span>. De momento se
          aplican los valores por defecto.
        </p>
      )}
    </div>
  );
}
