/** @type {import('next').NextConfig} */

// Cabeceras de seguridad (pilar 6) aplicadas a todas las rutas del frontend.
// No incluye CSP (rompería el script inline de tema y el widget cross-origin;
// se difiere a un change con nonces).
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
