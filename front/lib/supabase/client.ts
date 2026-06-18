'use client';
// Supabase browser client (auth only) — AA front.
// AA has NO direct data client: all data goes through the AA back via Bearer token.
// This client is ONLY for auth operations: signInWithPassword, signOut, getSession,
// onAuthStateChange. A single client is enough (no schema split needed).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Returns true if both required env vars are present and non-empty. */
export function isSupabaseEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

let _client: SupabaseClient | null | undefined;

/**
 * Singleton Supabase browser client for auth operations.
 * Uses default schema (no schema override) — required for supabase.auth.* to work.
 * Returns null if NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are unset.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  if (!isSupabaseEnabled()) { _client = null; return null; }
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    },
  );
  return _client;
}

/** Reset singleton (useful in tests). */
export function _resetSupabaseClient(): void {
  _client = undefined;
}
