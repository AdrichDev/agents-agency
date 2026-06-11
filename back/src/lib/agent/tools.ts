import type { ToolDefinition } from "@/lib/agent/types";

/** Tools disponibles por proveedor de integración. */
export const TOOLS_BY_PROVIDER: Record<string, ToolDefinition[]> = {
  gmail: [
    {
      name: "list_emails",
      description: "Lista los emails del buzón. Útil para revisar correo nuevo o sin leer.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Búsqueda Gmail, p.ej. 'is:unread'" },
          maxResults: { type: "number", description: "Máximo de emails (por defecto 10)" },
        },
      },
    },
    {
      name: "read_email",
      description: "Lee el contenido completo de un email por su id.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "label_email",
      description: "Aplica una etiqueta a un email (la crea si no existe). Sirve para clasificar correo.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string" }, label: { type: "string" } },
        required: ["id", "label"],
      },
    },
    {
      name: "archive_email",
      description: "Archiva un email (lo quita de la bandeja de entrada).",
      input_schema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "send_email",
      description: "Envía un email.",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["to", "subject", "body"],
      },
    },
  ],
  slack: [
    {
      name: "send_slack_message",
      description: "Envía un mensaje a un canal o usuario de Slack.",
      input_schema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Nombre o id del canal, p.ej. '#general'" },
          text: { type: "string" },
        },
        required: ["channel", "text"],
      },
    },
    {
      name: "list_slack_messages",
      description: "Lee los últimos mensajes de un canal de Slack.",
      input_schema: {
        type: "object",
        properties: { channel: { type: "string" }, limit: { type: "number" } },
        required: ["channel"],
      },
    },
  ],
  jira: [
    {
      name: "create_jira_issue",
      description: "Crea un ticket/issue en Jira.",
      input_schema: {
        type: "object",
        properties: {
          projectKey: { type: "string", description: "Clave del proyecto, p.ej. 'SUP'" },
          summary: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", description: "Highest|High|Medium|Low" },
        },
        required: ["projectKey", "summary"],
      },
    },
    {
      name: "list_jira_issues",
      description: "Busca issues en Jira con JQL.",
      input_schema: {
        type: "object",
        properties: { jql: { type: "string", description: "p.ej. 'project=SUP AND status=Open'" } },
        required: ["jql"],
      },
    },
  ],
  calendar: [
    {
      name: "list_calendar_events",
      description: "Lista los próximos eventos del calendario.",
      input_schema: {
        type: "object",
        properties: { maxResults: { type: "number" }, days: { type: "number", description: "Ventana en días (por defecto 7)" } },
      },
    },
    {
      name: "create_calendar_event",
      description: "Crea un evento en el calendario.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          startIso: { type: "string", description: "Fecha-hora ISO 8601 de inicio" },
          endIso: { type: "string", description: "Fecha-hora ISO 8601 de fin" },
          description: { type: "string" },
          attendees: { type: "array", items: { type: "string" }, description: "Emails de invitados" },
        },
        required: ["title", "startIso", "endIso"],
      },
    },
  ],
};

/** Tool de búsqueda en la base de conocimiento, siempre disponible. */
export const KNOWLEDGE_TOOL: ToolDefinition = {
  name: "search_knowledge",
  description:
    "Busca en la base de conocimiento del agente (web y documentos del cliente). Úsala antes de responder preguntas sobre el negocio del cliente.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};

/** Devuelve las tools activas para un agente según sus integraciones conectadas. */
export function toolsForProviders(providers: string[]): ToolDefinition[] {
  const tools = [KNOWLEDGE_TOOL];
  for (const p of providers) tools.push(...(TOOLS_BY_PROVIDER[p] ?? []));
  return tools;
}
