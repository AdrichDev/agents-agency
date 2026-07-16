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
      // aa-dashboard-agents-nav-widgets T2.2 (fix P1): antes se deslogueaba ante
      // CUALQUIER 401, incluido uno de fondo/cosmético disparado por un race
      // (fetch de montaje justo tras el login, antes de que la sesión de Supabase
      // terminase de hidratar — ver T2.1). Eso podía expulsar a un usuario recién
      // logueado. Ahora solo forzamos signOut+redirect cuando la sesión está
      // REALMENTE caducada/ausente; si el token local sigue vigente, el 401 se
      // trata como un falso positivo (race, clock skew, u otra causa de fondo) y
      // simplemente se propaga el error sin tocar la sesión.
      //
      // Reusa el mismo diagnóstico ya instrumentado (aa-bug-generar-prompt-redirect):
      //   sin sesión local           → realmente sin sesión → LOGOUT real.
      //   sesión con exp desconocido → no se puede confirmar vigencia → LOGOUT real
      //                                 (conservador: no dejar una sesión zombie).
      //   delta < 0 (exp en pasado)  → confirma expiración → LOGOUT real.
      //   delta >= 0 (exp en futuro) → el token local AÚN es válido → el 401 NO es
      //                                 por expiración → falso positivo, NO desloguear.
      const diagClient = getSupabaseClient();
      let genuinelyExpiredOrGone = true;
      try {
        const { data: diag } = (await diagClient?.auth.getSession()) ?? { data: { session: null } };
        const exp = diag.session?.expires_at;
        if (diag.session == null) {
          genuinelyExpiredOrGone = true;
          console.warn(`[api] 401 en ${path}; sin sesión activa en el interceptor`);
        } else if (exp != null) {
          const deltaS = Math.round((exp * 1000 - Date.now()) / 1000);
          genuinelyExpiredOrGone = deltaS < 0;
          console.warn(
            `[api] 401 en ${path}; sesión delta=${deltaS}s (${
              genuinelyExpiredOrGone
                ? "EXPIRADO → logout real"
                : "aún válido → falso positivo, NO se desloguea"
            })`,
          );
        } else {
          // Sesión presente pero sin expires_at: no se puede confirmar vigencia.
          // Conservador — se trata como expiración real (nunca rompemos el
          // deslogueo legítimo por un caso ambiguo).
          genuinelyExpiredOrGone = true;
        }
      } catch {
        /* diagnóstico best-effort; ante fallo, conservador: tratar como expiración real */
      }

      if (genuinelyExpiredOrGone) {
        // scope:'local' limpia la sesión del navegador SIN llamar a supabase.co.
        // Con scope global (default), si la red a Supabase falla el catch traga el
        // error y la sesión local PUEDE quedar viva → getSession devuelve el token
        // rancio → la landing reintenta /dashboard → 401 → bucle. Local siempre
        // limpia → user=null garantizado → fin del bucle.
        await diagClient?.auth.signOut({ scope: "local" }).catch(() => {});
        // Páginas públicas (landing + legales): un 401 de fondo NO debe expulsar al
        // usuario a la landing. Sin esta exención, las páginas legales parpadeaban y
        // redirigían a "/?returnTo=..." al cargar sin sesión.
        const PUBLIC_PATHS = ["/", "/privacidad", "/aviso-legal", "/cookies"];
        const onPublic = PUBLIC_PATHS.includes(window.location.pathname);
        if (!onPublic) {
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
    }
    throw new ApiError(res.status, body);
  }

  return body as T;
}
