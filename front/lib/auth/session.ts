'use client';
// AA Auth session helpers.
// login  → supabase.auth.signInWithPassword
// logout → supabase.auth.signOut
// token  → supabase.auth.getSession().data.session?.access_token
//
// After login the token is sent as Bearer to the AA back.
// The AA back (GET /api/auth/me) returns the aa.User profile {user, role}.
// NEVER read role from JWT user_metadata — it is not populated.
import { getSupabaseClient } from '@/lib/supabase/client';

export interface AAUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

/**
 * Login via Supabase Auth signInWithPassword.
 * Resolves the aa.User profile from the backend GET /api/auth/me (source of truth).
 * Returns the profile so callers can set React state immediately.
 */
export async function login(email: string, password: string): Promise<AAUser> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no configurado');

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);

  const session = data.session;
  if (!session) throw new Error('No se obtuvo sesión de Supabase');

  // Resolve profile from authoritative backend (NOT from JWT user_metadata).
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const res = await fetch(`${base}/api/auth/me`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    // Session valid but no aa.User profile — sign out and surface a clear error.
    await supabase.auth.signOut().catch(() => {});
    throw new Error('Usuario no encontrado en el sistema. Contacta con el administrador.');
  }
  const me = (await res.json()) as { user?: AAUser };
  if (!me.user) throw new Error('Perfil de usuario inválido');
  return me.user;
}

/** Sign out via Supabase Auth. Best-effort (never throws). */
export async function logout(): Promise<void> {
  const supabase = getSupabaseClient();
  if (supabase) {
    await supabase.auth.signOut().catch(() => {});
  }
}

/**
 * Returns the current session access_token, or null.
 * Reads from local storage — no network call.
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
