// Allowlist de rutas públicas bajo /api. Todo lo demás exige sesión válida.
// Extraído de index.ts para poder testearlo sin arrancar el servidor.
//
// SEGURIDAD: solo los WEBHOOKS de mensajería son públicos (autentican con el
// secret/HMAC del proveedor). La GESTIÓN de canales (connect/status/delete) NO
// es pública — requiere sesión.
type PublicRule = { method: string; match: (path: string) => boolean };

const exact = (m: string, p: string): PublicRule => ({ method: m, match: (x) => x === p });
const prefix = (m: string, p: string): PublicRule => ({ method: m, match: (x) => x.startsWith(p) });

export const PUBLIC_RULES: PublicRule[] = [
  exact("POST", "/api/auth/login"),
  exact("POST", "/api/auth/logout"),
  exact("GET", "/api/auth/me"),
  exact("POST", "/api/public/leads"), // GET /api/public/leads queda protegido
  exact("POST", "/api/chat"),
  exact("GET", "/api/widget/config"),
  // Webhooks de mensajería (PÚBLICOS). SOLO webhooks, NO gestión:
  //  POST /api/channels/telegram|whatsapp/:agentId  → recepción
  //  GET  /api/channels/whatsapp/:agentId           → verify (Meta)
  // connect (POST /:provider/connect), status (GET /:agentId/status) y delete
  // (DELETE /:provider/:agentId) quedan protegidos.
  { method: "POST", match: (x) => /^\/api\/channels\/(telegram|whatsapp)\/(?!connect$)[^/]+$/.test(x) },
  { method: "GET", match: (x) => /^\/api\/channels\/whatsapp\/(?!status$)[^/]+$/.test(x) },
  // Cron / webhook de automatizaciones: usan CRON_SECRET / AUTOMATION_WEBHOOK_SECRET
  exact("GET", "/api/cron/automations"),
  { method: "POST", match: (x) => /^\/api\/automations\/[^/]+\/execute$/.test(x) },
  // Booking: rutas públicas para widget (slots, reserve)
  prefix("GET", "/api/booking/slots"),
  prefix("POST", "/api/booking/reserve"),
];

export function isPublic(method: string, path: string): boolean {
  return PUBLIC_RULES.some(
    (r) => (r.method === "ANY" || r.method === method) && r.match(path)
  );
}

// ── Auth de servicio (server-to-server CRM→AA) ──────────────────────────────
// El CRM ejecuta generación IA reusando AA (clave OpenAI + modelos). Coste de
// PLATAFORMA, no del cupo del cliente → SIN metering. El CRM llama con
// AA_SERVICE_TOKEN; ese token SOLO vale para estos endpoints de generación (no abre
// el resto de la API). Comparación en tiempo constante (timingSafeEqual).
import crypto from "node:crypto";

export const SERVICE_RULES: { method: string; path: string }[] = [
  { method: "POST", path: "/api/ai/marketing-plan" },
  { method: "POST", path: "/api/ai/generate" },
  { method: "POST", path: "/api/market-studies" },
];

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * true si la petición es una llamada de servicio válida (token correcto Y path en
 * SERVICE_RULES). `serviceToken` inyectable para test; por defecto AA_SERVICE_TOKEN.
 * Si no hay token configurado → siempre false (no se abre nada por accidente).
 */
export function isServiceCall(
  method: string,
  fullPath: string,
  authHeader?: string,
  serviceToken: string = process.env.AA_SERVICE_TOKEN ?? ""
): boolean {
  if (!serviceToken || !authHeader?.startsWith("Bearer ")) return false;
  if (!tokensEqual(authHeader.slice(7), serviceToken)) return false;
  return SERVICE_RULES.some((r) => r.method === method && r.path === fullPath);
}
