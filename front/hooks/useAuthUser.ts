"use client";
// AA auth hook — Supabase session-driven.
// Replaces polling GET /api/auth/me with supabase.auth.onAuthStateChange.
// On session available: resolves the aa.User profile via GET /api/auth/me (Bearer).
// On SIGNED_OUT / no session: resets user to null.
// logout() → supabase.auth.signOut (AA back POST /auth/logout returns 410).
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { api } from "@/lib/api";

export interface AuthUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

async function fetchProfile(): Promise<AuthUser | null> {
  try {
    const data = await api<{ user?: AuthUser }>("/api/auth/me");
    return data?.user ?? null;
  } catch {
    return null;
  }
}

/** AA session hook. user = null when not authenticated or profile not yet resolved. */
export function useAuthUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      // Supabase not configured — stay unauthenticated.
      setLoading(false);
      return;
    }

    // Hydrate immediately from the existing session (no network call for the session itself).
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        const profile = await fetchProfile();
        setUser(profile);
      }
      setLoading(false);
    });

    // Subscribe to auth state changes (login, logout, token refresh).
    // IMPORTANT: the callback runs while auth-js holds its internal Navigator
    // LockManager lock. Calling ANY supabase.auth.* method (e.g. getSession via
    // fetchProfile → api → getToken) synchronously inside it deadlocks → the UI
    // freezes on "Entrando...". Defer the work with setTimeout(…, 0) so it runs
    // AFTER the lock is released. Official Supabase guidance.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          // SIGNED_IN or TOKEN_REFRESHED — fetch the authoritative profile,
          // deferred out of the lock.
          setTimeout(async () => {
            const profile = await fetchProfile();
            setUser(profile);
          }, 0);
        } else {
          // SIGNED_OUT or session expired.
          setUser(null);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
    setUser(null);
  }

  return { user, loading, logout };
}
