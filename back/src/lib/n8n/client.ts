/**
 * Cliente REST para la API v1 de n8n.
 *
 * Modo noop: si N8N_BASE_URL o N8N_API_KEY no están definidos, todas las
 * operaciones devuelven { ok: true, workflowId: null, status: "pending" }
 * y registran un warning una vez. El resto del sistema no distingue noop de éxito.
 *
 * Errores de red / 5xx: se capturan, se loguea el contexto y se devuelve
 * { ok: false, workflowId: null, status: "error" }. Nunca se relanza.
 */
import type { N8nWorkflow, SyncResult } from "./types";

let _noopWarningLogged = false;

/** true solo si N8N_BASE_URL y N8N_API_KEY están definidas. */
export function isConfigured(): boolean {
  return Boolean(process.env.N8N_BASE_URL && process.env.N8N_API_KEY);
}

function noopResult(): SyncResult {
  if (!_noopWarningLogged) {
    console.warn("[n8n] N8N_BASE_URL not set – running in noop mode");
    _noopWarningLogged = true;
  }
  return { ok: true, workflowId: null, status: "pending" };
}

function buildHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-N8N-API-KEY": process.env.N8N_API_KEY ?? "",
  };
}

function baseUrl(): string {
  return (process.env.N8N_BASE_URL ?? "").replace(/\/$/, "");
}

async function safeFetch(
  operation: string,
  workflowId: string | null,
  fn: () => Promise<Response>
): Promise<SyncResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fn();
    clearTimeout(timeout);

    if (res.status === 404) {
      console.warn(`[n8n] 404 for ${operation}${workflowId ? ` workflowId=${workflowId}` : ""}`);
      return { ok: false, workflowId: null, status: "error", notFound: true };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[n8n] ${operation} failed status=${res.status} body=${body.slice(0, 200)}`);
      return { ok: false, workflowId: null, status: "error" };
    }

    // Intentar leer el id del workflow si la respuesta tiene cuerpo JSON
    let returnedId: string | null = workflowId;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (data?.id) returnedId = String(data.id);
    }

    return { ok: true, workflowId: returnedId, status: "synced" };
  } catch (err) {
    clearTimeout(timeout);
    console.error(`[n8n] ${operation} network error${workflowId ? ` workflowId=${workflowId}` : ""}:`, err);
    return { ok: false, workflowId: null, status: "error" };
  }
}

export async function createWorkflow(wf: N8nWorkflow): Promise<SyncResult> {
  if (!isConfigured()) return noopResult();
  return safeFetch("createWorkflow", null, () =>
    fetch(`${baseUrl()}/api/v1/workflows`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(wf),
    })
  );
}

export async function updateWorkflow(workflowId: string, wf: N8nWorkflow): Promise<SyncResult> {
  if (!isConfigured()) return noopResult();
  return safeFetch("updateWorkflow", workflowId, () =>
    fetch(`${baseUrl()}/api/v1/workflows/${workflowId}`, {
      method: "PUT",
      headers: buildHeaders(),
      body: JSON.stringify(wf),
    })
  );
}

export async function activateWorkflow(workflowId: string): Promise<SyncResult> {
  if (!isConfigured()) return noopResult();
  return safeFetch("activateWorkflow", workflowId, () =>
    fetch(`${baseUrl()}/api/v1/workflows/${workflowId}/activate`, {
      method: "POST",
      headers: buildHeaders(),
    })
  );
}

export async function deactivateWorkflow(workflowId: string): Promise<SyncResult> {
  if (!isConfigured()) return noopResult();
  return safeFetch("deactivateWorkflow", workflowId, () =>
    fetch(`${baseUrl()}/api/v1/workflows/${workflowId}/deactivate`, {
      method: "POST",
      headers: buildHeaders(),
    })
  );
}

export async function deleteWorkflow(workflowId: string): Promise<SyncResult> {
  if (!isConfigured()) return noopResult();
  return safeFetch("deleteWorkflow", workflowId, () =>
    fetch(`${baseUrl()}/api/v1/workflows/${workflowId}`, {
      method: "DELETE",
      headers: buildHeaders(),
    })
  );
}

export async function getWorkflow(workflowId: string): Promise<SyncResult> {
  if (!isConfigured()) return noopResult();
  return safeFetch("getWorkflow", workflowId, () =>
    fetch(`${baseUrl()}/api/v1/workflows/${workflowId}`, {
      method: "GET",
      headers: buildHeaders(),
    })
  );
}
