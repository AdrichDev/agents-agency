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

/**
 * Builds the OpenClaw config entry for one AA agent.
 *
 * NOTE (aa-openclaw-provision-hardening): no `workspace` field on purpose.
 * The old value ("aa-<id>", a relative path) pointed to a directory nobody
 * ever created or deployed (unlike main/citas, whose workspace_src is copied
 * by setup.sh) → undefined behavior. AA agents live off `systemPrompt` only,
 * which is a defined, self-contained persona. A real per-agent workspace
 * (IDENTITY.md template) is a possible future improvement.
 */
export function buildAgentEntry(agent: AgentForSync): Record<string, unknown> {
  return {
    id: openclawAgentId(agent.id),
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
    if (idx >= 0) {
      const merged: Record<string, any> = { ...list[idx], ...entry };
      // Limpieza del workspace fantasma legado ("aa-<id>" relativo, nunca desplegado).
      if (merged.workspace === targetId) delete merged.workspace;
      list[idx] = merged;
    } else {
      list.push(entry);
    }
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
  if (!found) {
    return { ok: true, status: "synced", pendingRestart: true, provisionState: "pending", reason: "read-back missing agent entry" };
  }

  // Estado REAL (aa-openclaw-provision-hardening): "en la config" no basta —
  // el gateway solo sirve el agente tras un restart. `provisioned` de verdad =
  // su target aparece en GET /v1/models. Si aún no aparece → `pending` con
  // pendingRestart, y el recheck / cron de reconciliación lo re-evalúa después.
  const live = await agentTargetIsLive(targetId);
  return {
    ok: true,
    status: "synced",
    pendingRestart: !live,
    provisionState: live ? "provisioned" : "pending",
    ...(live ? {} : { reason: "in config but not served yet — gateway restart pending" }),
  };
}

/** ¿El gateway está sirviendo YA este target? (GET /v1/models, fail-soft → false). */
async function agentTargetIsLive(targetId: string): Promise<boolean> {
  const models = await adminRpc.listModels();
  if (!models.ok) return false;
  const ids = Array.isArray(models.payload?.data) ? models.payload!.data! : [];
  return ids.some((m) => {
    const id = typeof m?.id === "string" ? m.id : "";
    return id === targetId || id === `openclaw/${targetId}` || id.endsWith(`/${targetId}`);
  });
}

// ── Reconciliación BD ↔ OpenClaw (aa-openclaw-provision-hardening) ──────────

export interface ReconcileAgentState {
  agentId: string;
  provisionState: OpenClawProvisionState;
  reason?: string;
}

export interface ReconcileResult {
  ok: boolean;
  reason?: string;
  /** Ids openclaw (aa-*) retirados por no existir ya en la BD. */
  removedOrphans: string[];
  /** Estado por agente de la BD tras reconciliar. */
  states: ReconcileAgentState[];
}

/**
 * Reconciliación completa en UNA pasada (config.get → merge → config.patch):
 * upsert de TODOS los agentes runtime="openclaw" de la BD, retirada de las
 * entradas aa-* huérfanas (sin fila en BD) y estado en vivo por agente vía
 * /v1/models. Repara los agujeros del sync por-evento fail-soft: agente creado
 * con el gateway caído, borrado que no llegó, o lista pisada por un restart.
 * Solo hace config.patch si la lista cambió. Fail-soft como todo lo demás.
 */
export async function reconcileAgentsProvisioning(agents: AgentForSync[]): Promise<ReconcileResult> {
  return serialized(() => reconcileAgentsProvisioningUnsafe(agents));
}

async function reconcileAgentsProvisioningUnsafe(agents: AgentForSync[]): Promise<ReconcileResult> {
  const desired = agents.filter((a) => a.runtime === "openclaw");

  const snapshot = await adminRpc.configGet();
  if (!snapshot.ok) {
    logger.warn(`[openclaw-reconcile] config.get failed: ${snapshot.error}`);
    return { ok: false, reason: snapshot.error, removedOrphans: [], states: [] };
  }

  const config = extractConfig(snapshot.payload);
  const current: any[] = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const desiredIds = new Set(desired.map((a) => openclawAgentId(a.id)));

  // Entradas no gestionadas por AA (main, citas, openclaw…) se conservan tal cual.
  const kept = current.filter((e) => !(typeof e?.id === "string" && e.id.startsWith("aa-")));
  const removedOrphans = current
    .filter((e) => typeof e?.id === "string" && e.id.startsWith("aa-") && !desiredIds.has(e.id))
    .map((e) => e.id as string);

  const next = [...kept];
  for (const agent of desired) {
    const targetId = openclawAgentId(agent.id);
    const existing = current.find((e) => e?.id === targetId);
    const entry = buildAgentEntry(agent);
    const merged: Record<string, any> = existing ? { ...existing, ...entry } : entry;
    if (merged.workspace === targetId) delete merged.workspace;
    next.push(merged);
  }

  if (JSON.stringify(next) !== JSON.stringify(current)) {
    const patch = await adminRpc.configPatch({ agents: { list: next } }, ["agents.list"]);
    if (!patch.ok) {
      logger.warn(`[openclaw-reconcile] config.patch failed: ${patch.error}`);
      return { ok: false, reason: patch.error, removedOrphans: [], states: [] };
    }
    if (removedOrphans.length) {
      logger.info(`[openclaw-reconcile] removed orphan entries: ${removedOrphans.join(", ")}`);
    }
  }

  const models = await adminRpc.listModels();
  const liveIds = models.ok && Array.isArray(models.payload?.data)
    ? models.payload!.data!.map((m) => (typeof m?.id === "string" ? m.id : ""))
    : [];
  const isLive = (targetId: string) =>
    liveIds.some((id) => id === targetId || id === `openclaw/${targetId}` || id.endsWith(`/${targetId}`));

  const states: ReconcileAgentState[] = desired.map((agent) => {
    const targetId = openclawAgentId(agent.id);
    const live = models.ok ? isLive(targetId) : false;
    return {
      agentId: agent.id,
      provisionState: live ? "provisioned" : "pending",
      ...(live ? {} : { reason: models.ok ? "in config but not served yet — gateway restart pending" : models.error }),
    };
  });

  return { ok: true, removedOrphans, states };
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
