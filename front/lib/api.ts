// AA back API client.
// Replaces cookie credentials:'include' with Authorization: Bearer <access_token>.
// The token comes from the Supabase session (getSession) — never from a cookie.
// getToken refreshes proactively when the token is near expiry; on a genuine 401 the
// browser is redirected to '/?returnTo=<path>' so login can send the user back.
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

/** Margen (ms) antes de la expiración a partir del cual refrescamos el token. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Returns the current Supabase access token, or null if no active session. */
export async function getToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  let session = data.session;
  if (!session) return null;

  // Refresco proactivo: getSession() devuelve el token guardado SIN forzar refresh.
  // En una pestaña en segundo plano el temporizador de auto-refresh puede no dispararse,
  // así que el access_token puede estar caducado mientras el refresh_token sigue válido.
  // Enviar el token rancio provoca un 401 y el handler global cierra la sesión — esto
  // era el bug "Generar prompt redirige al homepage": prompts es el primer click tras el
  // chat largo del decálogo, tiempo de idle suficiente para que el token expire. Si va a
  // expirar pronto, refrescamos antes de usarlo.
  // `expires_at` es opcional en el tipo de auth-js. Si no viene, NO asumimos que
  // expira ya (eso dispararía refreshSession en CADA llamada); dejamos que el 401 de
  // abajo trate la caducidad real. Solo refrescamos cuando sabemos que está por vencer.
  const expiresAtMs = session.expires_at != null ? session.expires_at * 1000 : null;
  const willExpireSoon =
    expiresAtMs != null && expiresAtMs - Date.now() < TOKEN_REFRESH_MARGIN_MS;
  if (willExpireSoon) {
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    // Si el refresh falla (refresh_token también inválido) mantenemos el token actual;
    // el back devolverá 401 y el handler de abajo lo trata como sesión realmente caducada.
    if (!error && refreshed.session) session = refreshed.session;
  }

  return session.access_token ?? null;
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
      // Instrumentación (aa-bug-generar-prompt-redirect): capturar el estado de la
      // sesión JUSTO en el 401, ANTES del signOut, para confirmar/refutar en producción
      // la hipótesis "token caducado en idle". NO se loguea el token, solo el delta de
      // expiración y el path (el id de landing no es sensible).
      //   delta < 0  → token ya caducado al llegar el 401 → confirma expiración (y que el
      //                refresco proactivo no alcanzó: refresh_token también inválido).
      //   delta >= 0 → token AÚN válido pero 401 → REFUTA expiración → causa es otra
      //                (clock skew back↔Supabase, sub sin fila en aa.User, aud/iss).
      //   sin sesión → usuario realmente sin sesión.
      const diagClient = getSupabaseClient();
      try {
        const { data: diag } = (await diagClient?.auth.getSession()) ?? { data: { session: null } };
        const exp = diag.session?.expires_at;
        if (exp != null) {
          const deltaS = Math.round((exp * 1000 - Date.now()) / 1000);
          console.warn(`[api] 401 en ${path}; sesión delta=${deltaS}s (${deltaS < 0 ? "EXPIRADO" : "aún válido → causa NO es expiración"})`);
        } else {
          console.warn(`[api] 401 en ${path}; sin sesión activa en el interceptor`);
        }
      } catch {
        /* diagnóstico best-effort; nunca romper el flujo de error */
      }

      await diagClient?.auth.signOut({ scope: "local" }).catch(() => {});
      const onLanding = window.location.pathname === "/";
      if (!onLanding) {
        // Preservar dónde estaba el usuario para que el flujo de login lo devuelva ahí
        // tras reautenticarse (patrón returnTo, consumido por aa-bug-acceso-sin-sesion).
        // Si el modal de login aún no lee returnTo, el parámetro queda inerte en la URL
        // (forward-compatible, no rompe nada).
        // Quitar cualquier returnTo preexistente del search antes de reencodear, para
        // no anidar (returnTo=%2Ffoo%3FreturnTo%3D...). Siempre es un path same-origin.
        const here = new URL(window.location.href);
        here.searchParams.delete("returnTo");
        const returnTo = here.pathname + here.search;
        window.location.href = `/?returnTo=${encodeURIComponent(returnTo)}`;
      }
    }
    throw new ApiError(res.status, body);
  }

  return body as T;
}
