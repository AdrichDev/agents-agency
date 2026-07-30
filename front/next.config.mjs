import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */

// Origen del backend, del que la web carga `widget.js` y al que el widget habla.
// Estaba escrito a mano como `http://localhost:4000`, el backend de desarrollo: en
// producción la política autorizaba una máquina local y dejaba fuera al backend real.
// No rompía nada porque va en modo Report-Only, pero el día que se promocione a enforcing
// se lleva por delante el chatbot de la propia web. Se deriva de la misma variable que usa
// `lib/api.ts`, así que no puede volver a desalinearse.
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").origin;
  } catch {
    return "http://localhost:4000";
  }
})();

// CSP en modo Report-Only (pilar 6): evalúa y reporta violaciones SIN bloquear,
// para introducir CSP sin riesgo. Promoción a enforcing + nonces = change futuro.
const cspReportOnly = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${apiOrigin}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}`,
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
  // Directorio de build conmutable por entorno. Por defecto `.next`, el de siempre.
  // Existe para que los e2e puedan levantar su propio servidor sin compartir el `.next`
  // del servidor de desarrollo que alguien tenga abierto: dos procesos de Next escribiendo
  // el mismo directorio lo dejan inservible y hay que borrarlo a mano. Con
  // `NEXT_DIST_DIR=.next-e2e` cada uno escribe el suyo.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Fija la raíz de tracing a este proyecto: hay un package-lock.json
  // en el workspace padre que hace a Next inferir mal la raíz.
  outputFileTracingRoot: __dirname,
  // Hardening (pilar 1): no exponer source maps de navegador en producción,
  // para que el código fuente y las llaves no queden a la vista.
  productionBrowserSourceMaps: false,
  // Solo dev: el indicador de Dev Tools (<nextjs-portal>) se superpone a la esquina
  // inferior e intercepta los clicks del widget flotante de Telegram en los e2e.
  // No existe en producción; el overlay de errores de dev sigue funcionando.
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default nextConfig;
