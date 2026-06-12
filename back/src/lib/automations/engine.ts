import { prisma } from "@/lib/db";
import { runAgent } from "@/lib/agent/engine";
import { SERVICE_TO_PROVIDER } from "@/lib/integrations/service-map";

/**
 * Motor de automatizaciones — lo invoca el cron de Vercel cada 5 min
 * y el endpoint POST /api/automations/:id/execute (vía n8n o UI).
 *
 * R5-1 (anti-duplicidad n8n): el cron salta automatizaciones que tengan
 * n8nWorkflowId != null AND syncStatus = "synced" — esas las dispara n8n.
 * Si n8nWorkflowId = null (noop, error, legacy) el cron las ejecuta siempre.
 *
 * NOTA triggers de evento: new_email/new_slack_message se crean en n8n como
 * Webhook, pero el push externo (Gmail watch / Slack Events) está fuera de
 * alcance de esta fase. Mientras tanto el cron las sigue ejecutando
 * (syncStatus se deja en "pending" o "error", nunca "synced" para esos triggers
 * en esta fase — ver design.md riesgo #6).
 */

const triggerContext: Record<string, string> = {
  new_email: (since: string) =>
    `Revisa los emails recibidos después de ${since} (usa list_emails con query "is:unread after:${Math.floor(new Date(since).getTime() / 1000)}"). Si no hay ninguno, responde únicamente "SIN_NOVEDADES".`,
  new_slack_message: (since: string) =>
    `Revisa los mensajes nuevos de Slack desde ${since}. Si no hay ninguno, responde únicamente "SIN_NOVEDADES".`,
  schedule: () => "Ejecuta la tarea programada ahora.",
} as unknown as Record<string, string>;

function getTriggerContext(trigger: string, since: Date): string {
  const iso = since.toISOString();
  if (trigger === "new_email") {
    const unixSince = Math.floor(since.getTime() / 1000);
    return `Revisa los emails recibidos después de ${iso} (usa list_emails con query "is:unread after:${unixSince}"). Si no hay ninguno, responde únicamente "SIN_NOVEDADES".`;
  }
  if (trigger === "new_slack_message") {
    return `Revisa los mensajes nuevos de Slack desde ${iso}. Si no hay ninguno, responde únicamente "SIN_NOVEDADES".`;
  }
  return "Ejecuta la tarea programada ahora.";
}

/**
 * Ejecuta una sola automatización: valida provider, corre el agente,
 * crea AutomationRun y actualiza lastRunAt.
 * Es autosuficiente — recarga la fila con su include propio.
 */
export async function runAutomation(id: string): Promise<{ status: string; summary: string }> {
  const automation = await prisma.automation.findUnique({
    where: { id },
    include: {
      agent: {
        include: { integrations: { select: { provider: true, status: true } } },
      },
    },
  });

  if (!automation) return { status: "error", summary: "Automation not found" };

  // Mapa provider → status para validación rápida
  const providerStatus = new Map(
    automation.agent.integrations.map((i: { provider: string; status: string }) => [
      i.provider,
      i.status,
    ])
  );
  const since = automation.lastRunAt ?? new Date(Date.now() - 30 * 60_000);

  // Validar que el provider del trigger esté conectado
  if (automation.trigger === "new_email") {
    const googleStatus = providerStatus.get("google");
    if (!googleStatus || googleStatus !== "connected") {
      const result = { status: "skipped", summary: "Integration requerida (google/gmail) no configurada para el agente" };
      await prisma.automationRun.create({
        data: { automationId: id, status: result.status, summary: result.summary, toolCalls: [] },
      });
      return result;
    }
  }
  if (automation.trigger === "new_slack_message") {
    const slackStatus = providerStatus.get("slack");
    if (!slackStatus || slackStatus !== "connected") {
      const result = { status: "skipped", summary: "Integration requerida (slack) no configurada para el agente" };
      await prisma.automationRun.create({
        data: { automationId: id, status: result.status, summary: result.summary, toolCalls: [] },
      });
      return result;
    }
  }

  // Validar service del config
  const configService = (automation.config as { service?: string } | null)?.service;
  if (configService) {
    const requiredProvider = SERVICE_TO_PROVIDER[configService];
    if (requiredProvider) {
      const provStatus = providerStatus.get(requiredProvider);
      if (!provStatus || provStatus !== "connected") {
        const result = {
          status: "skipped",
          summary: `Integration requerida (${requiredProvider}) no configurada para el agente`,
        };
        await prisma.automationRun.create({
          data: { automationId: id, status: result.status, summary: result.summary, toolCalls: [] },
        });
        return result;
      }
    }
  }

  const message = `${getTriggerContext(automation.trigger, since)}\n\nInstrucciones de la automatización:\n${automation.prompt}`;

  let status = "ok";
  let summary = "";
  let toolCalls: unknown[] = [];
  try {
    const reply = await runAgent(automation.agentId, message);
    toolCalls = reply.toolCalls;
    summary = reply.text.slice(0, 1000);
    if (reply.text.includes("SIN_NOVEDADES")) status = "skipped";
  } catch (e) {
    status = "error";
    summary = e instanceof Error ? e.message : String(e);
  }

  await prisma.automationRun.create({
    data: {
      automationId: id,
      status,
      summary,
      toolCalls: JSON.parse(JSON.stringify(toolCalls)),
    },
  });
  await prisma.automation.update({
    where: { id },
    data: { lastRunAt: new Date() },
  });

  return { status, summary };
}

/**
 * Itera todas las automatizaciones activas y ejecuta las que no gestiona n8n.
 * R5-1: omite silenciosamente las que tienen n8nWorkflowId + syncStatus="synced".
 */
export async function runAutomations() {
  const automations = await prisma.automation.findMany({
    where: { enabled: true },
    select: { id: true, n8nWorkflowId: true, syncStatus: true, name: true },
  });

  const results = [];

  for (const a of automations) {
    // R5-1: skip sin AutomationRun — estas las dispara n8n
    if (a.n8nWorkflowId && a.syncStatus === "synced") continue;

    const r = await runAutomation(a.id);
    results.push({ automation: a.name, status: r.status, summary: r.summary.slice(0, 200) });
  }

  return results;
}
