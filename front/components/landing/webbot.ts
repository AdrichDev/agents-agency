import { API } from "@/lib/api";

/**
 * Webbot = widget de chat embebible (back/public/widget.js) ligado a un agente.
 * El propio HTML de la landing es la fuente de verdad: el snippet vive antes de
 * </body>. Estas utilidades lo inyectan / detectan / quitan, y permiten
 * re-inyectarlo tras una regeneración (que sobrescribe los archivos).
 */

const WIDGET_TAG_RE = /<script[^>]*data-agent-key="[^"]*"[^>]*><\/script>\s*/gi;
const WIDGET_KEY_RE = /<script[^>]*data-agent-key="([^"]*)"[^>]*><\/script>/i;

/** Clave pública del agente embebido en el HTML, o null si no hay webbot. */
export function getWebbotKey(html: string): string | null {
  const m = html.match(WIDGET_KEY_RE);
  return m ? m[1] : null;
}

export function buildSnippet(publicKey: string): string {
  return `<script src="${API}/widget.js" data-agent-key="${publicKey}"></script>`;
}

/** Quita cualquier webbot previo del HTML. */
export function removeWebbot(html: string): string {
  return html.replace(WIDGET_TAG_RE, "");
}

/** Inserta (o reemplaza) el webbot antes de </body>. */
export function injectWebbot(html: string, publicKey: string): string {
  const cleaned = removeWebbot(html);
  const snippet = buildSnippet(publicKey) + "\n";
  if (/<\/body>/i.test(cleaned)) {
    return cleaned.replace(/<\/body>/i, `${snippet}</body>`);
  }
  return `${cleaned}\n${snippet}`;
}
