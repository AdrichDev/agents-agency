/**
 * Import de workflows n8n como automatizaciones del agente — F5 T5.4
 * (aa-agent-backend-foundation, AC8).
 *
 * Camino principal de Automatizaciones: pegar el JSON de un workflow o adoptar
 * uno existente de NUESTRA instancia n8n (multi-tenant) por ID. Scoping
 * ESTRICTO por agente:
 *  - Todo workflow creado desde un JSON se nombra con el tag `[agent:<id>]`.
 *  - Un workflow ya vinculado a otro agente (fila Automation) no puede
 *    adoptarse (409), y un workflow cuyo nombre lleva el tag de OTRO agente
 *    tampoco (403) — sin cruce de tenants.
 *  - Es workflow-como-automatización (trigger externo en n8n), NO
 *    workflow-as-tool (design.md §F, v2). El cron interno nunca los ejecuta.
 */
import { prisma } from "@/lib/db";
import * as n8n from "@/lib/n8n/client";
import type { N8nWorkflow } from "@/lib/n8n/types";
import { HttpError } from "@/lib/http";

/** Trigger reservado para workflows importados (el cron interno los omite). */
export const IMPORTED_TRIGGER = "imported";

const AGENT_TAG_RE = /\[agent:([A-Za-z0-9_-]+)\]/;

/** Nombre scopeado por agente que se persiste en la instancia n8n. */
export function buildScopedWorkflowName(agentId: string, name: string): string {
  return `[agent:${agentId}] ${name}`.slice(0, 128);
}

/** Extrae el agentId del tag de scoping del nombre del workflow (o null). */
export function agentIdFromWorkflowName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  return name.match(AGENT_TAG_RE)?.[1] ?? null;
}

/**
 * Valida y sanea un JSON de workflow pegado por el usuario: solo se conservan
 * name/nodes/connections/settings (nada de pinData, staticData, credenciales
 * sueltas ni campos desconocidos que la API v1 rechazaría).
 */
export function sanitizeWorkflowJson(raw: unknown): N8nWorkflow {
  if (typeof raw !== "object" || raw === null) {
    throw new HttpError(400, "workflowJson debe ser un objeto JSON de workflow n8n");
  }
  const wf = raw as Record<string, unknown>;
  if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) {
    throw new HttpError(400, "Workflow inválido: falta el array nodes");
  }
  if (typeof wf.connections !== "object" || wf.connections === null) {
    throw new HttpError(400, "Workflow inválido: falta el objeto connections");
  }
  return {
    name: typeof wf.name === "string" && wf.name.trim() ? wf.name.trim() : "Workflow importado",
    nodes: wf.nodes as N8nWorkflow["nodes"],
    connections: wf.connections as N8nWorkflow["connections"],
    ...(typeof wf.settings === "object" && wf.settings !== null
      ? { settings: wf.settings as N8nWorkflow["settings"] }
      : {}),
  };
}

export interface ImportWorkflowInput {
  agentId: string;
  /** Nombre visible de la automatización (default: el del workflow). */
  name?: string;
  /** Camino A: JSON del workflow pegado por el usuario. */
  workflowJson?: unknown;
  /** Camino B: ID de un workflow existente de nuestra instancia. */
  n8nWorkflowId?: string;
}

/**
 * Importa el workflow y lo persiste como Automation del agente. Devuelve la
 * fila creada. Lanza HttpError con estados honestos (400/403/404/409/503).
 */
export async function importWorkflowForAgent(input: ImportWorkflowInput) {
  const { agentId } = input;
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } });
  if (!agent) throw new HttpError(404, "Agente no encontrado");

  if (Boolean(input.workflowJson) === Boolean(input.n8nWorkflowId)) {
    throw new HttpError(400, "Indica workflowJson O n8nWorkflowId (exactamente uno)");
  }

  let workflowId: string | null = null;
  let syncStatus = "pending";
  let displayName: string;
  let source: "json" | "instance";

  if (input.workflowJson) {
    // Camino A: crear el workflow en nuestra instancia con nombre scopeado.
    // Paridad con el camino B (:119): sin n8n configurado no hay dónde crear
    // el workflow, así que fallamos honesto ANTES de tocar la BD — nada de
    // fila Automation inerte ni de perder el workflowJson en silencio.
    if (!n8n.isConfigured()) {
      throw new HttpError(
        503,
        "El motor de automatización (n8n) está apagado; no se pueden importar workflows ahora."
      );
    }
    source = "json";
    const wf = sanitizeWorkflowJson(input.workflowJson);
    displayName = input.name?.trim() || wf.name;
    const created = await n8n.createWorkflow({
      ...wf,
      name: buildScopedWorkflowName(agentId, displayName),
    });
    workflowId = created.workflowId;
    syncStatus = created.status;
    if (created.status === "synced" && created.workflowId) {
      const activated = await n8n.activateWorkflow(created.workflowId);
      if (!activated.ok) syncStatus = "error";
    }
  } else {
    // Camino B: adoptar un workflow existente por ID — scoping estricto.
    source = "instance";
    const targetId = String(input.n8nWorkflowId);

    const linked = await prisma.automation.findFirst({
      where: { n8nWorkflowId: targetId },
      select: { id: true, agentId: true },
    });
    if (linked && linked.agentId !== agentId) {
      throw new HttpError(409, "Ese workflow ya pertenece a otro agente");
    }
    if (linked) throw new HttpError(409, "Ese workflow ya está importado en este agente");

    if (!n8n.isConfigured()) {
      throw new HttpError(503, "n8n no está configurado (N8N_BASE_URL/N8N_API_KEY)");
    }
    const detail = await n8n.getWorkflowDetail(targetId);
    if (!detail) throw new HttpError(404, "Workflow no encontrado en la instancia n8n");

    const taggedAgent = agentIdFromWorkflowName(detail.name);
    if (taggedAgent && taggedAgent !== agentId) {
      throw new HttpError(403, "Ese workflow está scopeado a otro agente");
    }

    displayName =
      input.name?.trim() ||
      (typeof detail.name === "string" ? detail.name.replace(AGENT_TAG_RE, "").trim() : "") ||
      "Workflow importado";
    workflowId = targetId;
    syncStatus = "synced";
  }

  return prisma.automation.create({
    data: {
      agentId,
      name: displayName,
      trigger: IMPORTED_TRIGGER,
      // El workflow importado vive y se dispara en n8n: no hay prompt NL.
      prompt: "",
      config: { imported: true, source },
      n8nWorkflowId: workflowId,
      syncStatus,
    },
  });
}
