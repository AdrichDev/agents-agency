/**
 * Cliente REST para el plugin admin-http-rpc de OpenClaw (F2 —
 * openspec/changes/aa-openclaw-brain, verificado en spike.md §4 opción B).
 *
 * Endpoint: POST {OPENCLAW_ADMIN_URL}/api/v1/admin/rpc
 * Auth: Authorization: Bearer OPENCLAW_GATEWAY_TOKEN (mismo token que el
 * cliente de chat de F1 — ver lib/openai.ts).
 * Body: { method: "config.get" | "config.patch", params: {...} }.
 * Respuesta: { ok: true, payload: ... } | { ok: false, error?: string }.
 *
 * Modo noop: si el host admin o el token no están configurados, todas las
 * llamadas devuelven { ok: false, error: "noop: ..." } sin lanzar. Igual
 * patrón fail-soft que lib/n8n/client.ts — el llamador NUNCA debe romper la
 * petición HTTP del usuario porque el gateway de OpenClaw esté caído.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);

export interface RpcResult<T = unknown> {
  ok: boolean;
  payload?: T;
  error?: string;
}

let _noopWarningLogged = false;

/**
 * Host del admin RPC. Prioriza OPENCLAW_ADMIN_URL explícito; si no está
 * definido, lo deriva de OPENCLAW_BASE_URL (el de chat, F1) quitando el
 * sufijo /v1 — mismo host/puerto, distinta ruta (spike.md: el /v1 es solo
 * para chat/completions, el admin RPC vive en /api/v1/admin/rpc del mismo host).
 */
function adminBaseUrl(): string | undefined {
  if (process.env.OPENCLAW_ADMIN_URL) return process.env.OPENCLAW_ADMIN_URL.replace(/\/$/, "");
  const chatBase = process.env.OPENCLAW_BASE_URL;
  if (chatBase) return chatBase.replace(/\/v1\/?$/, "");
  return undefined;
}

function gatewayAuthSecret(): string | undefined {
  return process.env.OPENCLAW_GATEWAY_PASSWORD || process.env.OPENCLAW_GATEWAY_TOKEN;
}

export function isConfigured(): boolean {
  return Boolean(adminBaseUrl() && gatewayAuthSecret());
}

function noop<T>(reason: string): RpcResult<T> {
  if (!_noopWarningLogged) {
    logger.warn(`[openclaw-admin] not configured – running in noop mode (${reason})`);
    _noopWarningLogged = true;
  }
  return { ok: false, error: `noop: ${reason}` };
}

/**
 * Métodos cuyos params pueden llevar un secreto (token de Telegram vía
 * config.patch de channels.telegram) o contenido privado de conversación
 * (chat.send: el gateway puede eco-ar el mensaje en errores de validación) —
 * nunca logueamos el body de error para estos.
 */
const SENSITIVE_METHODS = new Set(["config.patch", "chat.send"]);

async function rpc<T = unknown>(method: string, params: Record<string, unknown>): Promise<RpcResult<T>> {
  if (!isConfigured()) return noop("OPENCLAW_ADMIN_URL/OPENCLAW_GATEWAY_PASSWORD missing");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${adminBaseUrl()}/api/v1/admin/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayAuthSecret()}`,
      },
      body: JSON.stringify({ method, params }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const bodySnippet = SENSITIVE_METHODS.has(method)
        ? "[omitido: método sensible, puede contener secretos]"
        : (await res.text().catch(() => "")).slice(0, 200);
      logger.error(`[openclaw-admin] ${method} failed status=${res.status} body=${bodySnippet}`);
      return { ok: false, error: `http ${res.status}` };
    }

    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; payload?: T; error?: string };
    if (!data.ok) {
      logger.warn(`[openclaw-admin] ${method} returned ok:false error=${data.error ?? "unknown"}`);
      return { ok: false, error: data.error ?? "rpc returned ok:false" };
    }
    return { ok: true, payload: data.payload };
  } catch (err) {
    clearTimeout(timeout);
    logger.error({ err }, `[openclaw-admin] ${method} network error:`);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface OpenclawConfigSnapshot {
  config?: Record<string, any>;
  hash?: string;
  [key: string]: unknown;
}

/** config.get — snapshot completo de la config viva de OpenClaw + hash. */
export function configGet(): Promise<RpcResult<OpenclawConfigSnapshot>> {
  return rpc<OpenclawConfigSnapshot>("config.get", {});
}

/**
 * config.patch — merge parcial. Para reemplazar un array completo (en vez de
 * mergearlo campo a campo) hay que declarar su path en `replacePaths`
 * (p.ej. ["agents.list"]). `patch` y `replacePaths` viajan juntos dentro de
 * `params` (params.replacePaths, según el contrato verificado del plugin).
 */
export function configPatch(
  patch: Record<string, unknown>,
  replacePaths: string[] = []
): Promise<RpcResult<OpenclawConfigSnapshot>> {
  return rpc<OpenclawConfigSnapshot>("config.patch", { ...patch, replacePaths });
}

export interface GatewayModelsPayload {
  data?: Array<{ id?: string }>;
  [key: string]: unknown;
}

/**
 * GET /v1/models del gateway — lista los targets de agente que el gateway
 * SIRVE ahora mismo (a diferencia de config.get, que refleja la config en
 * disco aunque requiera restart). Es la sonda "en vivo" del aprovisionamiento
 * (aa-openclaw-provision-hardening): un agente está `provisioned` de verdad
 * solo si su target aparece aquí. Mismo fail-soft noop que el resto.
 */
export async function listModels(): Promise<RpcResult<GatewayModelsPayload>> {
  const base = chatBaseUrl();
  const auth = gatewayAuthSecret();
  if (!base || !auth) return noop("OPENCLAW_BASE_URL/OPENCLAW_GATEWAY_PASSWORD missing");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${base}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${auth}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      logger.warn(`[openclaw-admin] models failed status=${res.status}`);
      return { ok: false, error: `http ${res.status}` };
    }
    return { ok: true, payload: (await res.json().catch(() => ({}))) as GatewayModelsPayload };
  } catch (err) {
    clearTimeout(timeout);
    logger.error({ err }, "[openclaw-admin] models network error:");
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* OpenClaw operator chat for @Estudio3ABot.
 * The live gateway exposes writes through /v1/chat/completions, while HTTP admin
 * RPC does not expose chat.history/chat.send. History is read from the local
 * OpenClaw session JSONL (direct file in tests/dev, Docker container in live). */

export interface ChatHistoryOpts {
  limit?: number;
  maxChars?: number;
}

async function readJsonlEntries(raw: string, limit: number): Promise<unknown[]> {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown)
    .filter((entry) => (entry as any)?.type === "message")
    .slice(-limit);
}

async function historyFromTranscriptFile(limit: number): Promise<unknown[] | null> {
  const file = process.env.OPENCLAW_OPERATOR_TRANSCRIPT_FILE;
  if (!file) return null;
  const raw = await readFile(file, "utf8");
  return readJsonlEntries(raw, limit);
}

async function historyFromDocker(sessionKey: string, limit: number): Promise<unknown[]> {
  const container = process.env.OPENCLAW_DOCKER_CONTAINER || "OpenClaw_Agents_3A";
  if (!/^[a-zA-Z0-9_.-]+$/.test(container)) throw new Error("invalid OPENCLAW_DOCKER_CONTAINER");
  const script = `
const fs = require('node:fs');
const path = require('node:path');
const key = process.argv[1];
const limit = Number(process.argv[2] || 50);
const storePath = '/home/node/.openclaw/agents/main/sessions/sessions.json';
const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
const sessions = Array.isArray(store.sessions) ? store.sessions : Object.values(store.sessions || store || {});
const row = store[key] || sessions.find((s) => s && s.key === key) || sessions.find((s) => s && s.runtimePolicySessionKey === key);
if (!row || !row.sessionId) { console.log('[]'); process.exit(0); }
const jsonl = path.join(path.dirname(storePath), row.sessionId + '.jsonl');
const entries = fs.readFileSync(jsonl, 'utf8').split(/\\r?\\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => entry.type === 'message').slice(-limit);
console.log(JSON.stringify(entries));
`;
  const { stdout } = await execFileAsync("docker", ["exec", container, "node", "-e", script, sessionKey, String(limit)], { timeout: 8000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout || "[]") as unknown[];
}

export async function chatHistory(sessionKey: string, opts: ChatHistoryOpts = {}): Promise<RpcResult<unknown>> {
  const limit = opts.limit ?? 50;
  try {
    const fileEntries = await historyFromTranscriptFile(limit);
    const entries = fileEntries ?? await historyFromDocker(sessionKey, limit);
    return { ok: true, payload: { entries } };
  } catch (err) {
    logger.error({ err }, "[openclaw-chat] history read failed");
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function chatBaseUrl(): string | undefined {
  const base = process.env.OPENCLAW_BASE_URL;
  return base ? base.replace(/\/$/, "") : adminBaseUrl() ? `${adminBaseUrl()}/v1` : undefined;
}

export async function chatSend(
  sessionKey: string,
  message: string,
  idempotencyKey: string
): Promise<RpcResult<unknown>> {
  const base = chatBaseUrl();
  const auth = gatewayAuthSecret();
  if (!base || !auth) return noop("OPENCLAW_BASE_URL/OPENCLAW_GATEWAY_PASSWORD missing");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth}`,
        "x-openclaw-session-key": sessionKey,
        "x-openclaw-agent-id": process.env.OPENCLAW_OPERATOR_AGENT_ID || "main",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ model: "openclaw", messages: [{ role: "user", content: message }], stream: false, user: sessionKey }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    return { ok: true, payload: await res.json().catch(() => ({})) };
  } catch (err) {
    clearTimeout(timeout);
    logger.error({ err }, "[openclaw-chat] send failed");
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
