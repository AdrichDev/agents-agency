import rateLimit from "express-rate-limit";

/* ---------- Rate limiting ---------- */

/** Parses a positive integer from env, falling back to a default. */
function num(env: string | undefined, fallback: number): number {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// El rate limiting no aplica en tests (los suites disparan muchas peticiones).
// Vitest setea process.env.VITEST; también soportamos NODE_ENV=test.
const skipInTest = () => process.env.NODE_ENV === "test" || !!process.env.VITEST;

const base = { standardHeaders: true, legacyHeaders: false, skip: skipInTest } as const;

// (loginLimiter eliminado: el login real ocurre en Supabase Auth vía el SDK del
// front; el endpoint POST /login del back es un stub 410 — no procesa credenciales,
// así que un rate-limit ahí no protege de nada. Supabase aplica su propio límite.)

export const leadsLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: num(process.env.RATE_LIMIT_LEADS, 5),
  message: { error: "Demasiadas solicitudes. Inténtalo en un minuto." },
});

export const aiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: num(process.env.RATE_LIMIT_AI, 20),
  message: { error: "Demasiadas solicitudes a la IA. Inténtalo en un minuto." },
});

/**
 * Stricter limiter for cost-heavy batch operations (mass scraping, full AI
 * study/landing generation) that can burn AI credits and external API quota.
 */
export const heavyLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: num(process.env.RATE_LIMIT_HEAVY, 10),
  message: { error: "Operación costosa: demasiadas solicitudes. Inténtalo en un minuto." },
});

export const apiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: num(process.env.RATE_LIMIT_API, 300),
  message: { error: "Demasiadas solicitudes. Inténtalo más tarde." },
});
