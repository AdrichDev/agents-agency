import { jwtVerify, createRemoteJWKSet } from "jose";
import { createClient } from "@supabase/supabase-js";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Supabase Auth integration (Phase 4 — AA Back).
// Strategy: verify the Supabase access token against the project JWKS (ES256,
// asymmetric — Supabase's current signing scheme; the legacy HS256 shared secret
// does NOT apply), then load aa.User by id = sub to resolve the app-level role.
// AA is single-tenant: all authenticated users with a matching aa.User are admitted.
// No RLS, no Membership join needed (design D8).
// SERVICE_ROLE_KEY must NEVER be exposed to the browser.
// ---------------------------------------------------------------------------

const SUPABASE_BASE = (process.env.SUPABASE_URL ?? "https://placeholder.supabase.co")
  .replace(/\/+$/, "")
  .replace(/\.$/, "");
const SUPABASE_ISSUER = `${SUPABASE_BASE}/auth/v1`;
const JWKS = createRemoteJWKSet(new URL(`${SUPABASE_ISSUER}/.well-known/jwks.json`));

/**
 * Startup fail-closed check. With JWKS (ES256) verification the legacy shared
 * SUPABASE_JWT_SECRET is NOT needed. What we DO need is a real SUPABASE_URL (the
 * JWKS source used to verify tokens) and the service-role key for admin operations.
 */
export function assertAuthSecrets(): void {
  const url = process.env.SUPABASE_URL;
  if (!url || url.includes("placeholder")) {
    throw new Error(
      "SUPABASE_URL ausente o placeholder. Necesario para verificar access tokens vía JWKS " +
        "(Project Settings → API → Project URL)."
    );
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY ausente. Necesario para operaciones admin (createUser, signOut)."
    );
  }
}

export interface SupabaseTokenPayload {
  /** Subject = auth.users.id (UUID) */
  sub: string;
  email: string;
  /** Supabase Postgres role ('authenticated'); NOT the app-level aa.User.role. */
  role: string;
}

/**
 * Pure mapping of a verified JWT payload → SupabaseTokenPayload. Extracted so the
 * claim-shape contract is unit-testable without crypto/network.
 */
function extractSupabaseClaims(payload: { sub?: unknown; email?: unknown; role?: unknown }): SupabaseTokenPayload {
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Token payload missing sub");
  }
  return {
    sub: payload.sub,
    email: (payload.email as string) ?? "",
    role: (payload.role as string) ?? "authenticated",
  };
}

/**
 * Verifies a Supabase-issued access token against the project JWKS (ES256).
 * Throws on invalid/expired token — caller must catch and return 401.
 * Returns { sub, email, role } — sub is the auth.users UUID.
 */
export async function verifySupabaseToken(token: string): Promise<SupabaseTokenPayload> {
  const { payload } = await jwtVerify(token, JWKS, {
    algorithms: ["ES256"],
    issuer: SUPABASE_ISSUER,
    audience: "authenticated", // pin aud: solo tokens de usuario autenticado
  });
  return extractSupabaseClaims(payload);
}

/**
 * Supabase Admin client — service role, bypasses RLS.
 * Only used server-side for admin operations (createUser, signOut, etc.).
 * autoRefreshToken + persistSession disabled: stateless server usage.
 */
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder-service-role-key",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  role: string;
}

/**
 * Middleware: requires the authenticated user to have one of the given app-level roles.
 * Role is resolved from aa.User.role (not the Supabase JWT 'authenticated' role).
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "No autenticado" });
    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: "Permisos insuficientes" });
    }
    next();
  };
}
