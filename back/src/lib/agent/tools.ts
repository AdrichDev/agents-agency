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
    "Busca en la base de conocimiento del agente (web y documentos del cliente). " +
    "Cada resultado incluye 'source' (URL o documento de origen). Cita la fuente al " +
    "responder FAQ o recomendar productos. Úsala antes de responder preguntas sobre el negocio.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};

/** Tool para registrar intención de compra del usuario. Siempre disponible (AD9). */
export const INTENT_TOOL: ToolDefinition = {
  name: "record_lead_intent",
  description:
    "Registra el producto, servicio, plan o categoría concreta que interesa al usuario " +
    "cuando lo menciona explícitamente. Úsala una sola vez cuando detectes intención de compra clara.",
  input_schema: {
    type: "object",
    properties: {
      intent: { type: "string", description: "Ej: 'plan Pro', 'zapatillas running'" },
    },
    required: ["intent"],
  },
};

/** Tool para escalar la conversación a un humano. Siempre disponible (AD9). */
export const HANDOFF_TOOL: ToolDefinition = {
  name: "request_human_handoff",
  description:
    "Escala la conversación a una persona del equipo. Llámala cuando el usuario pida " +
    "hablar con un humano/agente, o cuando no puedas resolver su petición. " +
    "Después informa al usuario según el resultado que devuelva la herramienta.",
  input_schema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Motivo breve del escalado" },
    },
    required: [],
  },
};

/** Tools de ecommerce (condicionales — solo si orderStatusUrl configurado). */
export const ECOMMERCE_TOOLS: ToolDefinition[] = [
  {
    name: "get_order_status",
    description:
      "Consulta el estado de un pedido en el sistema del negocio. Requiere orderId. " +
      "Si el negocio no tiene configurada la consulta de pedidos, lo indicará: en ese caso " +
      "explícalo honestamente y ofrece escalar a una persona. Nunca inventes un estado.",
    input_schema: {
      type: "object",
      properties: {
        orderId: { type: "string" },
      },
      required: ["orderId"],
    },
  },
];

/**
 * Expande un proveedor físico a las claves lógicas de TOOLS_BY_PROVIDER.
 * "google" → ["gmail", "calendar"] (AD4: no renombramos tools).
 */
const PHYSICAL_TO_LOGICAL: Record<string, string[]> = {
  google: ["gmail", "calendar"],
};

// Poblar el provider ecommerce con las tools definidas arriba
TOOLS_BY_PROVIDER["ecommerce"] = ECOMMERCE_TOOLS;

/** Devuelve las tools activas para un agente según sus integraciones conectadas. */
export function toolsForProviders(providers: string[]): ToolDefinition[] {
  const tools = [KNOWLEDGE_TOOL];
  for (const p of providers) {
    // Expandir proveedor físico a sus claves lógicas si aplica
    const logical = PHYSICAL_TO_LOGICAL[p] ?? [p];
    for (const lp of logical) tools.push(...(TOOLS_BY_PROVIDER[lp] ?? []));
  }
  return tools;
}
