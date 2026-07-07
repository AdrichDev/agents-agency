/**
 * OpenClaw provisioning sync for Agents Agency agents.
 * Fail-soft: callers should not fail user HTTP requests when OpenClaw is down.
 */
import { logger } from "@/lib/logger";
import * as adminRpc from "./admin-rpc";
import { openclawAgentId } from "./agent-id";

export type ProvisionStatus = "synced" | "removed" | "skipped" | "error";
export type OpenClawProvisionState = "provisioned" | "pending" | "failed";

export interface ProvisionResult {
  ok: boolean;
  status: ProvisionStatus;
  pendingRestart?: boolean;
  reason?: string;
  provisionState?: OpenClawProvisionState;
}

interface AgentForSync {
  id: string;
  name: string;
  systemPrompt?: string | null;
  runtime?: string | null;
  temperature?: number | null;
}

function extractConfig(payload: unknown): Record<string, any> {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as Record<string, unknown>;
  if (p.config && typeof p.config === "object") return p.config as Record<string, any>;
  return p;
}

/** Builds the OpenClaw config entry for one AA agent. */
export function buildAgentEntry(agent: AgentForSync): Record<string, unknown> {
  return {
    id: openclawAgentId(agent.id),
    workspace: openclawAgentId(agent.id),
    identity: { name: agent.name },
    ...(agent.systemPrompt ? { systemPrompt: agent.systemPrompt } : {}),
    channels: {
      telegram: {
        managedBy: "agents-agency",
        mode: "aa-webhook",
      },
    },
    ...(typeof agent.temperature === "number" ? { params: { temperature: agent.temperature } } : {}),
  };
}

let provisioningQueue = Promise.resolve();

async function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = provisioningQueue.then(fn, fn);
  provisioningQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Sincroniza (upsert) o retira la entrada agents.list[] de un agente contra
 * la config viva de OpenClaw (config.get → mutar copia local → config.patch
 * con replacePaths=["agents.list"], única forma verificada de reemplazar un
 * array sin arrastrar entradas de otros agentes — spike.md §4).
 *
 * - runtime !== "openclaw" y remove=false → skip SIN llamar al gateway
 *   (nada que sincronizar; evita tráfico admin RPC en cada update de un
 *   agente openai normal).
 * - remove=true → intenta quitar la entrada si existe (delete de agente o
 *   cambio de runtime hacia fuera de "openclaw").
 */
export async function syncAgentProvisioning(
  agent: AgentForSync,
  opts: { remove?: boolean } = {}
): Promise<ProvisionResult> {
  const shouldRemove = opts.remove === true;
  if (!shouldRemove && agent.runtime !== "openclaw") {
    return { ok: true, status: "skipped", reason: "runtime is not openclaw" };
  }

  return serialized(() => syncAgentProvisioningUnsafe(agent, opts));
}

async function syncAgentProvisioningUnsafe(
  agent: AgentForSync,
  opts: { remove?: boolean } = {}
): Promise<ProvisionResult> {
  const shouldRemove = opts.remove === true;
  const snapshot = await adminRpc.configGet();
  if (!snapshot.ok) {
    logger.warn(`[openclaw-provision] config.get failed for agent=${agent.id}: ${snapshot.error}`);
    return { ok: false, status: "error", reason: snapshot.error };
  }

  const config = extractConfig(snapshot.payload);
  const list: any[] = Array.isArray(config?.agents?.list) ? [...config.agents.list] : [];
  const targetId = openclawAgentId(agent.id);
  const idx = list.findIndex((a) => a?.id === targetId);

  if (shouldRemove) {
    if (idx === -1) return { ok: true, status: "skipped", reason: "not provisioned" };
    list.splice(idx, 1);
  } else {
    const entry = buildAgentEntry(agent);
    if (idx >= 0) list[idx] = { ...list[idx], ...entry };
    else list.push(entry);
  }

  const patch = await adminRpc.configPatch({ agents: { list } }, ["agents.list"]);
  if (!patch.ok) {
    logger.warn(`[openclaw-provision] config.patch failed for agent=${agent.id}: ${patch.error}`);
    return { ok: false, status: "error", reason: patch.error };
  }

  if (shouldRemove) return { ok: true, status: "removed", pendingRestart: true };

  const readBack = await adminRpc.configGet();
  if (!readBack.ok) {
    logger.warn(`[openclaw-provision] config.get read-back failed for agent=${agent.id}: ${readBack.error}`);
    return { ok: true, status: "synced", pendingRestart: true, provisionState: "pending", reason: readBack.error };
  }
  const verifiedConfig = extractConfig(readBack.payload);
  const verifiedList: any[] = Array.isArray(verifiedConfig?.agents?.list) ? verifiedConfig.agents.list : [];
  const found = verifiedList.some((entry) => entry?.id === targetId);
  return {
    ok: true,
    status: "synced",
    pendingRestart: true,
    provisionState: found ? "provisioned" : "pending",
    ...(found ? {} : { reason: "read-back missing agent entry" }),
  };
}

// ── Channel handover (F2-T2) ────────────────────────────────────────────────

interface ChannelHandoverInput {
  agentId: string;
  /** EncryptedPayload tal cual se persiste en ChannelConnection.credentials (lib/crypto.ts). */
  encryptedCredentials: unknown;
}

/**
 * @deprecated Sin llamadores en producción desde 5.4a (aa-centro-mando-agenda-
 * telegram): la arquitectura «AA canal + cerebro OpenClaw» hace que AA registre
 * SIEMPRE su propio webhook por agente y NUNCA entregue el token del bot a
 * OpenClaw (su slot channels.telegram.botToken es global, no multi-bot).
 * Se conserva solo como referencia del handover F2-T2 retirado.
 *
 * Descifra el token de Telegram SOLO dentro de esta función (nunca sale de
 * aquí en claro, nunca se loguea, ni siquiera truncado) y lo entrega a
 * `channels.telegram` de OpenClaw vía config.patch.
 */
export async function provisionTelegramChannel(input: ChannelHandoverInput): Promise<ProvisionResult> {
  void input.encryptedCredentials;
  return {
    ok: true,
    status: "skipped",
    reason: "Telegram is managed per agent by Agents Agency webhooks; no OpenClaw global bot token handover",
  };
}
