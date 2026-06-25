// Catálogo y tipos compartidos del panel de automatizaciones. Extraído de
// AutomationsPanel sin cambios de valores.

export interface AutomationConfig {
  service?: string;
  action?: string;
  intervalMinutes?: number;
}

export interface Automation {
  id: string;
  name: string;
  trigger: string;
  prompt: string;
  config?: AutomationConfig;
  enabled: boolean;
  lastRunAt?: string | null;
  // R6-6: campos de sincronización n8n
  n8nWorkflowId?: string | null;
  syncStatus?: "synced" | "pending" | "error";
}

export interface AutomationFormState {
  name: string;
  trigger: string;
  prompt: string;
  service: string;
  action: string;
  intervalMinutes: number;
}

export const TRIGGERS: [string, string][] = [
  ["new_email", "📧 Email nuevo"],
  ["new_slack_message", "💬 Mensaje de Slack"],
  ["schedule", "⏰ Programado (job)"],
];

export const INTERVALS: [number, string][] = [
  [5, "Cada 5 minutos"],
  [15, "Cada 15 minutos"],
  [60, "Cada hora"],
  [1440, "Cada día"],
];

// Catálogo extensible de servicios y acciones. Base para generar
// los workflows de n8n (jobs programados o webhooks por evento).
export const SERVICES: { id: string; label: string; actions: [string, string][] }[] = [
  {
    id: "google_calendar",
    label: "📅 Google Calendar",
    actions: [
      ["create_event", "Crear evento"],
      ["list_events", "Listar eventos"],
      ["update_event", "Actualizar evento"],
      ["delete_event", "Eliminar evento"],
    ],
  },
  {
    id: "gmail",
    label: "📧 Gmail",
    actions: [
      ["send_email", "Enviar email"],
      ["label_email", "Etiquetar email"],
      ["draft_reply", "Crear borrador de respuesta"],
    ],
  },
  {
    id: "slack",
    label: "💬 Slack",
    actions: [
      ["post_message", "Publicar mensaje"],
      ["create_channel", "Crear canal"],
      ["summarize_channel", "Resumir canal"],
    ],
  },
  {
    id: "notion",
    label: "📝 Notion",
    actions: [
      ["create_page", "Crear página"],
      ["append_block", "Añadir contenido"],
      ["query_database", "Consultar base de datos"],
    ],
  },
  {
    id: "jira",
    label: "🎫 Jira",
    actions: [
      ["create_ticket", "Crear ticket"],
      ["transition_ticket", "Mover ticket"],
      ["comment_ticket", "Comentar ticket"],
    ],
  },
  {
    id: "instagram",
    label: "📸 Instagram",
    actions: [
      ["publish_post", "Publicar post"],
      ["schedule_post", "Programar post"],
    ],
  },
];

export const EXAMPLES = [
  "Clasifica cada email con una etiqueta (Urgente/Cliente/Spam). Para los urgentes crea un ticket en Jira proyecto SUP con prioridad High y avisa en #soporte de Slack.",
  "Si el email es una factura, archívalo con la etiqueta Facturas.",
  "Resume los mensajes de #ventas y crea eventos de calendario para las reuniones que se mencionen.",
];

export const EMPTY_FORM: AutomationFormState = {
  name: "",
  trigger: "new_email",
  prompt: "",
  service: "",
  action: "",
  intervalMinutes: 5,
};

export function describeConfig(config?: AutomationConfig) {
  if (!config?.service) return null;
  const service = SERVICES.find((s) => s.id === config.service);
  if (!service) return null;
  const action = service.actions.find(([id]) => id === config.action);
  return action ? `${service.label} → ${action[1]}` : service.label;
}
