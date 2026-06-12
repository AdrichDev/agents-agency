export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Error de API: lleva el status HTTP y el body parseado (si lo hubo). */
export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.error ?? `Error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include", // cookie de sesión del login
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  // Parseo tolerante: algunas respuestas (204) no traen body JSON.
  const text = await res.text();
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    // 401 en navegador: sesión caducada/ausente → volver al landing/login.
    if (res.status === 401 && typeof window !== "undefined") {
      const onLanding = window.location.pathname === "/";
      if (!onLanding) window.location.href = "/";
    }
    throw new ApiError(res.status, body);
  }

  return body as T;
}
