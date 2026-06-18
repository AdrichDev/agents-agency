// AA back API client.
// Replaces cookie credentials:'include' with Authorization: Bearer <access_token>.
// The token comes from the Supabase session (getSession) — never from a cookie.
// 401 behaviour preserved: redirects to '/' on the browser.
import { getSupabaseClient } from '@/lib/supabase/client';

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

/** Returns the current Supabase access token, or null if no active session. */
async function getToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers,
    // credentials:'include' removed — session is managed by Supabase (localStorage),
    // not by an HttpOnly cookie. Sending cookies is unnecessary and can confuse CORS.
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
    // 401 en navegador: sesión caducada/rancia. Cerrar la sesión de Supabase ANTES
    // de redirigir — si no, useAuthUser sigue con user!=null y la landing vuelve a
    // empujar a /dashboard → 401 → bucle infinito. signOut deja user=null → el
    // usuario aterriza en el login (sin loop, sin tener que borrar cookies).
    if (res.status === 401 && typeof window !== "undefined") {
      // scope:'local' limpia la sesión del navegador SIN llamar a supabase.co.
      // Con scope global (default), si la red a Supabase falla el catch traga el
      // error y la sesión local PUEDE quedar viva → getSession devuelve el token
      // rancio → la landing reintenta /dashboard → 401 → bucle. Local siempre
      // limpia → user=null garantizado → fin del bucle.
      await getSupabaseClient()?.auth.signOut({ scope: "local" }).catch(() => {});
      const onLanding = window.location.pathname === "/";
      if (!onLanding) window.location.href = "/";
    }
    throw new ApiError(res.status, body);
  }

  return body as T;
}
