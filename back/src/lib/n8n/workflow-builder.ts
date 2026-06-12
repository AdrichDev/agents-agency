/**
 * Genera el JSON de un workflow n8n v1 a partir de una Automation.
 *
 * Función pura — sin I/O ni efectos secundarios.
 * Lanza si el trigger es desconocido (no debe llegar a n8n).
 *
 * NOTA (riesgo #6 design): los triggers new_email/new_slack_message generan
 * un nodo Webhook en n8n, pero la activación del push externo (Gmail watch /
 * Slack Events) está fuera de alcance de esta fase. El cron interno sigue
 * ejecutando esas automatizaciones mientras syncStatus != "synced".
 * Solo los triggers "schedule" deben alcanzar syncStatus="synced" en esta fase.
 */
import type { N8nWorkflow } from "./types";

interface AutomationInput {
  id: string;
  name: string;
  trigger: string;
  config: { intervalMinutes?: number } | null;
}

function backUrl(): string {
  return (
    process.env.PUBLIC_URL ??
    process.env.BACK_URL ??
    "http://localhost:4000"
  ).replace(/\/$/, "");
}

function webhookSecret(): string {
  return process.env.AUTOMATION_WEBHOOK_SECRET ?? "";
}

export function buildWorkflow(automation: AutomationInput): N8nWorkflow {
  const executeUrl = `${backUrl()}/api/automations/${automation.id}/execute`;
  const secret = webhookSecret();

  const httpNode = {
    parameters: {
      method: "POST",
      url: executeUrl,
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: "X-Automation-Secret", value: secret }],
      },
      options: { timeout: 60_000 },
    },
    id: "http-node",
    name: "Call Backend Execute",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [480, 300] as [number, number],
  };

  if (automation.trigger === "schedule") {
    const intervalMinutes =
      (automation.config as { intervalMinutes?: number } | null)?.intervalMinutes ?? 5;

    const triggerNode = {
      parameters: {
        rule: {
          interval: [{ field: "minutes", minutesInterval: intervalMinutes }],
        },
      },
      id: "trigger-node",
      name: "Schedule Trigger",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.1,
      position: [260, 300] as [number, number],
    };

    return {
      name: `Automation ${automation.name} (${automation.id.slice(-6)})`,
      nodes: [triggerNode, httpNode],
      connections: {
        "Schedule Trigger": {
          main: [[{ node: "Call Backend Execute", type: "main", index: 0 }]],
        },
      },
      settings: { executionOrder: "v1" },
    };
  }

  if (
    automation.trigger === "new_email" ||
    automation.trigger === "new_slack_message"
  ) {
    const triggerNode = {
      parameters: {
        httpMethod: "POST",
        path: `automation-${automation.id}`,
        responseMode: "onReceived",
      },
      id: "trigger-node",
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [260, 300] as [number, number],
    };

    return {
      name: `Automation ${automation.name} (${automation.id.slice(-6)})`,
      nodes: [triggerNode, httpNode],
      connections: {
        Webhook: {
          main: [[{ node: "Call Backend Execute", type: "main", index: 0 }]],
        },
      },
      settings: { executionOrder: "v1" },
    };
  }

  throw new Error(`[workflow-builder] unknown trigger: "${automation.trigger}"`);
}
