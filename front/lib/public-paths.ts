/**
 * Rutas públicas del sitio: la landing y las tres páginas legales.
 *
 * Fuente única. Tres sitios dependen de esta lista y por razones distintas, así que
 * mantenerla en un solo módulo no es estética: si divergen, cada consumidor rompe de una
 * forma diferente y ninguna de las tres se parece a un fallo de la lista.
 *
 *  - `AppShell` las renderiza limpias, sin sidebar ni topbar.
 *  - `lib/api.ts` no expulsa a la landing cuando un 401 de fondo cae estando en una de
 *    ellas (un aviso legal no exige sesión).
 *  - `SiteWidget` monta el chat de 3A Estudio solo aquí, nunca sobre el panel.
 */
export const PUBLIC_PATHS = ["/", "/privacidad", "/aviso-legal", "/cookies"];

/** `true` si el path es una de las rutas públicas. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}
