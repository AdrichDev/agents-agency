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
import { logger } from "@/lib/logger";

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

export function isConfigured(): boolean {
  return Boolean(adminBaseUrl() && process.env.OPENCLAW_GATEWAY_TOKEN);
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
 * config.patch de channels.telegram) — nunca logueamos el body de error
 * para estos, aunque el gateway lo eche de vuelta en un mensaje de validación.
 */
const SENSITIVE_METHODS = new Set(["config.patch"]);

async function rpc<T = unknown>(method: string, params: Record<string, unknown>): Promise<RpcResult<T>> {
  if (!isConfigured()) return noop("OPENCLAW_ADMIN_URL/OPENCLAW_GATEWAY_TOKEN missing");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${adminBaseUrl()}/api/v1/admin/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN}`,
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
