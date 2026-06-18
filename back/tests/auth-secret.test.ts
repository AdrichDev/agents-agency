/**
 * auth-secret.test.ts — Phase 4 (startup auth env validation)
 *
 * With JWKS (ES256) verification the legacy SUPABASE_JWT_SECRET is no longer used.
 * assertAuthSecrets() now fail-closes on the env that JWKS actually needs:
 * SUPABASE_URL (the JWKS source) and SUPABASE_SERVICE_ROLE_KEY (admin ops).
 */
import { describe, it, expect, afterEach } from "vitest";
import { assertAuthSecrets } from "@/lib/auth";

const origUrl = process.env.SUPABASE_URL;
const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(() => {
  if (origUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = origUrl;
  if (origKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
});

describe("assertAuthSecrets — fail-closed on JWKS-critical env", () => {
  it("throws if SUPABASE_URL is absent", () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    expect(() => assertAuthSecrets()).toThrow(/SUPABASE_URL/);
  });

  it("throws if SUPABASE_URL is a placeholder", () => {
    process.env.SUPABASE_URL = "https://placeholder.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    expect(() => assertAuthSecrets()).toThrow(/SUPABASE_URL/);
  });

  it("throws if SUPABASE_SERVICE_ROLE_KEY is absent", () => {
    process.env.SUPABASE_URL = "https://real.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => assertAuthSecrets()).toThrow(/SERVICE_ROLE_KEY/);
  });

  it("passes with a real URL + service-role key", () => {
    process.env.SUPABASE_URL = "https://real.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    expect(() => assertAuthSecrets()).not.toThrow();
  });
});
