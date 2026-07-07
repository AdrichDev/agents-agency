// Builder de URLs de Google Maps a partir de una dirección en texto, portado
// de OperaOS (creador_CRM/front/lib/citas/google-maps-url.ts) para el detalle
// de cita de la agenda AA (aa-agenda-operaos-parity P5).
// PURO y testable: no hace llamadas a APIs externas ni usa API key embebida —
// el embed público de Google Maps (`/maps?q=...&output=embed`) funciona sin
// credenciales.

const BASE_EMBED_URL = "https://www.google.com/maps";
const BASE_SEARCH_URL = "https://www.google.com/maps/search/?api=1";

function direccionValida(direccion?: string | null): direccion is string {
  return typeof direccion === "string" && direccion.trim().length > 0;
}

/** URL para <iframe> embebido sin API key. Null si no hay dirección. */
export function buildGoogleMapsEmbedUrl(direccion?: string | null): string | null {
  if (!direccionValida(direccion)) return null;
  return `${BASE_EMBED_URL}?q=${encodeURIComponent(direccion.trim())}&output=embed`;
}

/** URL para el enlace "Abrir en Google Maps". Null si no hay dirección. */
export function buildGoogleMapsSearchUrl(direccion?: string | null): string | null {
  if (!direccionValida(direccion)) return null;
  return `${BASE_SEARCH_URL}&query=${encodeURIComponent(direccion.trim())}`;
}
