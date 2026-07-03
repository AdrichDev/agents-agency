/**
 * Servicio de sincronización agents-agency → OpenClaw (F2 —
 * openspec/changes/aa-openclaw-brain). agents-agency es el plano de control
 * (persona, canal, catálogo); OpenClaw es el plano de ejecución (modelo local).
 * Este módulo empuja los agentes runtime="openclaw" a `agents.list[]` de
 * OpenClaw vía admin-http-rpc (spike.md §4 opción B) y entrega el token de
 * Telegram en el handover de canal (F2-T2).
 *
 * Fail-soft SIEMPRE: ninguna función de este módulo lanza. Si el gateway está
 * caído o no configurado, se loguea y se devuelve { ok:false, status:"error" }
 * — el llamador (hooks en lib/agent/service.ts y routes/channels.ts) NUNCA
 * debe fallar la petición HTTP del usuario por esto, mismo patrón fail-soft
 * ya establecido en lib/n8n/client.ts.
 */
import { logger } from "@/lib/logger";
import { decrypt, type EncryptedPayload } from "@/lib/crypto";
import * as adminRpc from "./admin-rpc";
import { openclawAgentId } from "./agent-id";

export type ProvisionStatus = "synced" | "removed" | "skipped" | "error";

export interface ProvisionResult {
  ok: boolean;
  status: ProvisionStatus;
  /**
   * true si OpenClaw necesita reinicio del gateway para aplicar el cambio
   * (spike.md: el plugin admin-http-rpc no reinicia por sí solo). La
   * decisión de reiniciar es de ops — este servicio NUNCA reinicia el
   * gateway; solo informa al llamador de que puede haber un cambio pendiente.
   */
  pendingRestart?: boolean;
  reason?: string;
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
 * Construye la entrada agents.list[] para un agente AA. Cubre SOLO lo que
 * config.patch puede escribir hoy: identity (nombre) y params (temperature).
 * El systemPrompt/persona completo vive en el workspace propio del agente
 * OpenClaw (spike.md §3, ficheros de identidad/prompt) — ese mecanismo de
 * ficheros NO está automatizado por este servicio; es un gap conocido,
 * documentado en el resumen de esta apply (F2-T1).
 */
function buildAgentEntry(agent: AgentForSync): Record<string, unknown> {
  return {
    id: openclawAgentId(agent.id),
    workspace: openclawAgentId(agent.id),
    identity: { name: agent.name },
    ...(typeof agent.temperature === "number" ? { params: { temperature: agent.temperature } } : {}),
  };
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

  return { ok: true, status: shouldRemove ? "removed" : "synced", pendingRestart: true };
}

// ── Channel handover (F2-T2) ────────────────────────────────────────────────

interface ChannelHandoverInput {
  agentId: string;
  /** EncryptedPayload tal cual se persiste en ChannelConnection.credentials (lib/crypto.ts). */
  encryptedCredentials: unknown;
}

/**
 * Descifra el token de Telegram SOLO dentro de esta función (nunca sale de
 * aquí en claro, nunca se loguea, ni siquiera truncado) y lo entrega a
 * `channels.telegram` de OpenClaw vía config.patch. A partir de este punto
 * OpenClaw hace polling con ese token — routes/channels.ts es responsable de
 * NO registrar (o de borrar) el webhook de AA para evitar doble respuesta
 * (F2-T3).
 */
export async function provisionTelegramChannel(input: ChannelHandoverInput): Promise<ProvisionResult> {
  let token: string;
  try {
    const creds = JSON.parse(decrypt(input.encryptedCredentials as EncryptedPayload)) as { token: string };
    token = creds.token;
  } catch {
    // Nunca loguear el payload cifrado ni el error crudo: podría filtrar contexto del secreto.
    logger.error(`[openclaw-provision] failed to decrypt Telegram credentials (agent=${input.agentId})`);
    return { ok: false, status: "error", reason: "decrypt failed" };
  }
  if (!token) return { ok: false, status: "error", reason: "empty token" };

  const patch = await adminRpc.configPatch({ channels: { telegram: { botToken: token } } });
  if (!patch.ok) {
    logger.warn(`[openclaw-provision] channels.telegram patch failed for agent=${input.agentId}: ${patch.error}`);
    return { ok: false, status: "error", reason: patch.error };
  }
  return { ok: true, status: "synced", pendingRestart: true };
}
