import { prisma } from "@/lib/db";
import { searchKnowledge } from "@/lib/embeddings";
import * as gmail from "@/lib/integrations/gmail";
import * as slack from "@/lib/integrations/slack";
import * as jira from "@/lib/integrations/jira";
import * as calendar from "@/lib/integrations/calendar";
import { getValidToken } from "@/lib/integrations/oauth";
import { decryptToken } from "@/lib/integrations/oauth";
import { toPhysicalProvider } from "@/lib/integrations/service-map";
import {
  isWithinBusinessHours,
  mergeConversationMetadata,
  getConversationMetadata,
  buildConversationSummary,
  type EcommerceConfig,
} from "@/lib/agent/handoff";
import { fetchOrderStatus } from "@/lib/agent/order-status";

type Handler = (agentId: string, input: any, conversationId?: string) => Promise<unknown>;

/**
 * withToken resuelve la clave lógica (gmail, calendar) al proveedor físico (google)
 * mediante LOGICAL_TO_PHYSICAL, luego llama getValidToken para descifrar/refrescar.
 * Los nombres de tools y claves lógicas NO se modifican (AD4).
 */
const withToken =
  (logicalProvider: string, fn: (token: string, input: any, meta: any) => Promise<unknown>): Handler =>
  async (agentId, input) => {
    const physical = toPhysicalProvider(logicalProvider);
    const token = await getValidToken(agentId, physical);
    // Obtener metadata de la fila física para tools que la necesitan (Jira cloudId)
    const integration = await prisma.integration.findUnique({
      where: { agentId_provider: { agentId, provider: physical } },
      select: { metadata: true },
    });
    return fn(token, input, integration?.metadata ?? {});
  };

const HANDLERS: Record<string, Handler> = {
  search_knowledge: async (agentId, input) => searchKnowledge(agentId, input.query),

  list_emails: withToken("gmail", (t, i) => gmail.listEmails(t, i.query, i.maxResults)),
  read_email: withToken("gmail", (t, i) => gmail.readEmail(t, i.id)),
  label_email: withToken("gmail", (t, i) => gmail.labelEmail(t, i.id, i.label)),
  archive_email: withToken("gmail", (t, i) => gmail.archiveEmail(t, i.id)),
  send_email: withToken("gmail", (t, i) => gmail.sendEmail(t, i.to, i.subject, i.body)),

  send_slack_message: withToken("slack", (t, i) => slack.sendMessage(t, i.channel, i.text)),
  list_slack_messages: withToken("slack", (t, i) => slack.listMessages(t, i.channel, i.limit)),

  create_jira_issue: withToken("jira", (t, i, m) => jira.createIssue(t, m, i)),
  list_jira_issues: withToken("jira", (t, i, m) => jira.searchIssues(t, m, i.jql)),

  list_calendar_events: withToken("calendar", (t, i) => calendar.listEvents(t, i.days, i.maxResults)),
  create_calendar_event: withToken("calendar", (t, i) => {
    assertValidRange(i.startIso, i.endIso);
    return calendar.createEvent(t, i);
  }),

  // ── R3: Captura de intención de compra ─────────────────────────────────────
  record_lead_intent: async (agentId, input, conversationId) => {
    if (!conversationId) return { recorded: false };
    await mergeConversationMetadata(conversationId, { leadIntent: input.intent });
    return { recorded: true, intent: input.intent };
  },

  // ── R4: Handoff a humano ────────────────────────────────────────────────────
  request_human_handoff: async (agentId, input, conversationId) => {
    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
      select: { ecommerceConfig: true },
    });
    const cfg = agent.ecommerceConfig as EcommerceConfig;
    const within = isWithinBusinessHours(cfg);

    if (conversationId) {
      // R4-3: persistir handoff en metadata ANTES del intento Slack (AD8)
      await mergeConversationMetadata(conversationId, { handoff: true });

      // R4-3: upsert Lead con status=handoff (crear mínimo si no existe — caso "handoff sin lead")
      const meta = await getConversationMetadata(conversationId);
      await prisma.lead.upsert({
        where: { conversationId },
        create: {
          agentId,
          conversationId,
          customerName: (meta.leadFlow as any)?.customerName ?? "Visitante",
          status: "handoff",
        },
        update: { status: "handoff" },
      });

      // R4-6/R4-8: notificar Slack si canal configurado (degradación silenciosa)
      if (cfg?.handoffSlackChannel) {
        try {
          const summary = await buildConversationSummary(conversationId);
          await executeTool(
            agentId,
            "send_slack_message",
            { channel: cfg.handoffSlackChannel, text: summary },
            conversationId
          );
        } catch (e) {
          console.error("[handoff] Slack notify falló (degradación silenciosa):", e);
        }
      }
    }

    return {
      handed_off: true,
      withinBusinessHours: within,
      businessHours: cfg?.businessHours ?? null,
    };
  },

  // ── R5: Estado de pedido ────────────────────────────────────────────────────
  get_order_status: async (agentId, input) => {
    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
      select: { ecommerceConfig: true },
    });
    const cfg = agent.ecommerceConfig as EcommerceConfig;

    if (!cfg?.orderStatusUrl) {
      return {
        configured: false,
        message: "No tengo acceso configurado al sistema de pedidos de este negocio.",
      }; // R5-4
    }

    const apiKey = cfg.orderStatusApiKey ? decryptToken(cfg.orderStatusApiKey) : undefined;
    return fetchOrderStatus({ url: cfg.orderStatusUrl, apiKey }, input.orderId);
  },
};

/**
 * Valida que startIso y endIso sean ISO 8601 válidos y que end > start.
 * Lanza un Error con mensaje legible si falla; el loop agéntico lo captura y
 * lo devuelve al modelo como { error } para que el agente repregunta.
 */
export function assertValidRange(startIso: string, endIso: string): void {
  const s = Date.parse(startIso);
  const e = Date.parse(endIso);
  if (Number.isNaN(s)) throw new Error(`startIso no es ISO 8601 válido: "${startIso}"`);
  if (Number.isNaN(e)) throw new Error(`endIso no es ISO 8601 válido: "${endIso}"`);
  if (e <= s) throw new Error(`endIso (${endIso}) debe ser posterior a startIso (${startIso})`);
}

/**
 * Ejecuta una tool solicitada por el modelo contra la API real.
 * conversationId es opcional (retrocompatible) — necesario para record_lead_intent y request_human_handoff.
 */
export async function executeTool(
  agentId: string,
  name: string,
  input: unknown,
  conversationId?: string
) {
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`Tool desconocida: ${name}`);
  return handler(agentId, input, conversationId);
}
