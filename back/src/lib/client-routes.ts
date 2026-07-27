/**
 * H5 (aa-portal-cliente, T2.1) — Allowlist de lo que puede tocar un usuario con `role = "client"`.
 *
 * Deny-by-default, y esa es la decisión de este fichero. La alternativa —filtrar por tenant en cada
 * endpoint que se vaya acordando— falla en silencio: el endpoint que alguien olvide escopar devuelve
 * los datos de todos los clientes y no se nota hasta que un cliente lee lo del vecino. Aquí, un
 * router nuevo nace cerrado: si no está en `CLIENT_RULES`, un `client` recibe 403 y el olvido sale en
 * el primer test que lo pruebe.
 *
 * Mismo patrón que `public-routes.ts`: reglas puras, sin Express, para poder probarlas sin arrancar
 * el servidor.
 *
 * OJO con la relación entre las dos listas: esta allowlist NO gobierna las rutas públicas. Una ruta
 * pública (el widget, el login) es alcanzable por cualquiera, con sesión o sin ella, y por tanto
 * también por un `client`; la puerta la deja pasar antes de mirar aquí. Lo que esta lista gobierna es
 * el `/api` con sesión.
 */
type ClientRule = { methods: string[]; match: (path: string) => boolean };

export const CLIENT_RULES: ClientRule[] = [
  // Único acceso inicial: lectura bajo /api/portal. Sólo GET — el portal de H5 no escribe nada, y
  // abrir POST/PATCH "por si acaso" sería regalar superficie que ningún endpoint necesita todavía.
  { methods: ["GET"], match: (p) => p === "/api/portal" || p.startsWith("/api/portal/") },
  // Cambio de su propia contraseña. Entra en la lista con T5.1: el alta de usuario de portal fija una
  // contraseña inicial que el estudio entrega en mano, y sin este endpoint esa contraseña compartida
  // sería la definitiva. No abre superficie de datos — el endpoint sólo opera sobre `req.user.id` y
  // exige la contraseña actual, así que un `client` no puede tocar la cuenta de nadie más.
  { methods: ["POST"], match: (p) => p === "/api/auth/change-password" },
];

/**
 * true si un `client` puede llamar a este método+path.
 *
 * El path que se le pasa es el `originalUrl` ya sin query string, igual que en el gate de auth: una
 * regla que se comparara contra el path con `?...` no encajaría nunca y el efecto sería un 403 en algo
 * que sí debería estar permitido.
 */
export function isClientAllowed(method: string, path: string): boolean {
  return CLIENT_RULES.some((r) => r.methods.includes(method) && r.match(path));
}
