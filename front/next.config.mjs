/** @type {import('next').NextConfig} */

// CSP en modo Report-Only (pilar 6): evalúa y reporta violaciones SIN bloquear,
// para introducir CSP sin riesgo. Promoción a enforcing + nonces = change futuro.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' http://localhost:4000",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' http://localhost:4000",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Cabeceras de seguridad (pilar 6) aplicadas a todas las rutas del frontend.
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig = {
  // Hardening (pilar 1): no exponer source maps de navegador en producción,
  // para que el código fuente y las llaves no queden a la vista.
  productionBrowserSourceMaps: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default nextConfig;
