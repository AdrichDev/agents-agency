/**
 * Rutas de vuelta seguras (F-13). Una sola implementación para el login y para el asistente
 * de agentes: si hay dos, la segunda se olvida de un caso y vuelve la redirección abierta.
 *
 * `safeDestination` recibe el origen por parámetro para poder probarse sin navegador.
 */

export const DEFAULT_DESTINATION = "/dashboard";

/**
 * Por qué se valida PARSEANDO y comparando el ORIGEN, y no comparando prefijos:
 * la versión anterior comprobaba `startsWith("/")`, `"//"` y `"/\\"`, y se saltaba con un
 * tabulador, porque el parser de URL (WHATWG) **elimina** TAB, LF y CR antes de resolver:
 * `/<TAB>/evil.com` superaba los tres prefijos y el navegador lo resolvía a `https://evil.com`
 * (de 11 sondas se colaban 5). Aquí se normaliza con el mismo parser que decidirá la
 * navegación y se comparan orígenes; cualquier truco de escritura ya está deshecho. Se devuelve
 * `pathname + search + hash` normalizados, nunca la cadena original.
 */

/** Devuelve una ruta INTERNA (path+query+hash) del mismo origen, o el destino por defecto. */
export function safeDestination(returnTo: string | null, origin: string): string {
  if (!returnTo) return DEFAULT_DESTINATION;
  try {
    const url = new URL(returnTo, origin);
    if (url.origin !== origin) return DEFAULT_DESTINATION;
    return url.pathname + url.search + url.hash;
  } catch {
    // URL inválida: al dashboard. Ante la duda, nunca al destino que trae el parámetro.
    return DEFAULT_DESTINATION;
  }
}

/**
 * Añade/actualiza un parámetro de query respetando el hash: `/x#y` → `/x?k=v#y`
 * (no `/x#y?k=v`, que el navegador interpretaría como parte del fragmento).
 */
export function withQuery(ruta: string, clave: string, valor: string): string {
  const hashIdx = ruta.indexOf("#");
  const base = hashIdx === -1 ? ruta : ruta.slice(0, hashIdx);
  const hash = hashIdx === -1 ? "" : ruta.slice(hashIdx);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${encodeURIComponent(clave)}=${encodeURIComponent(valor)}${hash}`;
}

/** Destino tras crear un agente: solo rutas internas, con el id nuevo como parámetro. */
export function safeAgentCreatedDestination(
  returnTo: string | null,
  agentId: string,
  origin: string,
): string {
  return withQuery(safeDestination(returnTo, origin), "newAgentId", agentId);
}
