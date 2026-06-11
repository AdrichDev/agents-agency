import { prisma } from "@/lib/db";
import { searchKnowledge } from "@/lib/embeddings";
import * as gmail from "@/lib/integrations/gmail";
import * as slack from "@/lib/integrations/slack";
import * as jira from "@/lib/integrations/jira";
import * as calendar from "@/lib/integrations/calendar";
import { getAccessToken } from "@/lib/integrations/oauth";

type Handler = (agentId: string, input: any) => Promise<unknown>;

const withToken =
  (provider: string, fn: (token: string, input: any, meta: any) => Promise<unknown>): Handler =>
  async (agentId, input) => {
    const integration = await prisma.integration.findUnique({
      where: { agentId_provider: { agentId, provider } },
    });
    if (!integration) throw new Error(`El agente no tiene conectado ${provider}`);
    const token = await getAccessToken(integration);
    return fn(token, input, integration.metadata);
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
  create_calendar_event: withToken("calendar", (t, i) => calendar.createEvent(t, i)),
};

/** Ejecuta una tool solicitada por el modelo contra la API real. */
export async function executeTool(agentId: string, name: string, input: unknown) {
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`Tool desconocida: ${name}`);
  return handler(agentId, input);
}
