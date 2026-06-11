import { prisma } from "@/lib/db";
import { runAgent } from "@/lib/agent/engine";

/**
 * Motor de automatizaciones — lo invoca el cron de Vercel cada 5 min.
 * Para cada automatización activa construye un mensaje según su trigger
 * y deja que el agente decida qué tools ejecutar (clasificar emails,
 * crear tickets Jira, avisar por Slack, archivar...).
 */
export async function runAutomations() {
  const automations = await prisma.automation.findMany({
    where: { enabled: true },
    include: { agent: { include: { integrations: true } } },
  });

  const results = [];

  for (const automation of automations) {
    const providers = automation.agent.integrations.map((i: any) => i.provider);
    const since = automation.lastRunAt ?? new Date(Date.now() - 30 * 60_000);

    // Si el trigger requiere una integración que no está conectada, saltar
    if (automation.trigger === "new_email" && !providers.includes("gmail")) {
      results.push({ automation: automation.name, status: "skipped", reason: "gmail no conectado" });
      continue;
    }
    if (automation.trigger === "new_slack_message" && !providers.includes("slack")) {
      results.push({ automation: automation.name, status: "skipped", reason: "slack no conectado" });
      continue;
    }

    const triggerContext: Record<string, string> = {
      new_email: `Revisa los emails recibidos después de ${since.toISOString()} (usa list_emails con query "is:unread after:${Math.floor(since.getTime() / 1000)}"). Si no hay ninguno, responde únicamente "SIN_NOVEDADES".`,
      new_slack_message: `Revisa los mensajes nuevos de Slack desde ${since.toISOString()}. Si no hay ninguno, responde únicamente "SIN_NOVEDADES".`,
      schedule: "Ejecuta la tarea programada ahora.",
    };

    const message = `${triggerContext[automation.trigger] ?? ""}\n\nInstrucciones de la automatización:\n${automation.prompt}`;

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
        automationId: automation.id,
        status,
        summary,
        toolCalls: JSON.parse(JSON.stringify(toolCalls)),
      },
    });
    await prisma.automation.update({
      where: { id: automation.id },
      data: { lastRunAt: new Date() },
    });

    results.push({ automation: automation.name, status, summary: summary.slice(0, 200) });
  }

  return results;
}
