/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hardening (pilar 1): no exponer source maps de navegador en producción,
  // para que el código fuente y las llaves no queden a la vista.
  productionBrowserSourceMaps: false,
};
export default nextConfig;
