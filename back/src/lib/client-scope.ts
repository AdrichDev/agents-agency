/**
 * H5 (aa-portal-cliente, T2.2) — La puerta deny-by-default para usuarios de portal.
 *
 * Va después del gate de autenticación y antes del montaje de routers. Ese orden es el change: si los
 * endpoints de portal existieran antes que esta puerta, habría una ventana en la que un usuario con
 * `role = "client"` alcanza todo `/api`. Y si la puerta se montara después de los routers, no llegaría
 * a ejecutarse para las rutas que ya han respondido.
 *
 * Lo que NO hace, a propósito: no filtra datos. Decide si la petición sigue viva; el escopado por
 * tenant lo hace cada endpoint de portal con `req.user.tenantId`. Dos responsabilidades separadas —
 * una puerta que además filtrara daría la falsa sensación de que un endpoint nuevo ya viene escopado.
 */
import type { Request, Response, NextFunction } from "express";
import { isClientAllowed } from "@/lib/client-routes";
import { isPublic } from "@/lib/public-routes";
import { logger } from "@/lib/logger";

/** Rol de los usuarios de portal. Un solo sitio donde escribir la cadena. */
export const CLIENT_ROLE = "client";

/**
 * Deniega a un `client` todo lo que no esté en la allowlist de `client-routes.ts`.
 *
 * Orden interno, y cada paso está donde está por un motivo:
 *
 *   1. Ruta pública ⇒ pasa. El widget y el login son alcanzables sin sesión, así que bloquearlos a un
 *      `client` autenticado sería incoherente: el mismo navegador sin sesión sí entra.
 *   2. Sin `req.user` ⇒ pasa. Aquí no se decide autenticación; de eso ya respondió el gate anterior
 *      (401 en lo protegido). Devolver 403 desde aquí sólo cambiaría el código de error de un caso
 *      que ya está cerrado más arriba.
 *   3. Sin `tenantId` ⇒ pasa. Es la DEFINICIÓN de staff en este producto (`tenantId = null`).
 *      Se decide por el DATO, no por la etiqueta `role`: si un rol inesperado llegara con tenant
 *      (fila mal creada, migración manual, bug futuro), tratarlo como staff le abriría todos los
 *      tenants, porque los routers de staff no filtran por tenant (F-14 de la auditoría).
 *   4. `client` SIN `tenantId` ⇒ **403**. No es un caso teórico: es la invariante que el esquema no
 *      puede expresar (`tenant_id` es nullable porque `null` significa staff). Un `client` sin tenant
 *      es una fila mal creada, y lo único seguro que se puede hacer con ella es no servirla. La
 *      alternativa —dejarla pasar— es exactamente una consulta sin filtro de tenant.
 *   5. Ruta no permitida ⇒ 403.
 */
export function clientScopeGate(req: Request, res: Response, next: NextFunction) {
  const fullPath = req.originalUrl.split("?")[0];

  if (isPublic(req.method, fullPath)) return next();

  const user = req.user;
  if (!user) return next();

  // Sin tenant y sin rol de portal ⇒ staff: es el único caso que pasa sin confinamiento.
  if (!user.tenantId && user.role !== CLIENT_ROLE) return next();

  if (!user.tenantId) {
    // `client` sin tenant: fila corrupta. Se registra porque es un dato roto, no un intento de
    // intrusión, y no se sirve: la alternativa es una consulta sin filtro de tenant.
    logger.error(
      { userId: user.id },
      "[client scope] usuario con rol client sin tenantId: acceso denegado"
    );
    return res.status(403).json({ error: "Usuario de cliente sin tenant asignado" });
  }

  // Con tenant SIEMPRE se confina al portal, tenga el rol que tenga (F-14): la pertenencia a un
  // negocio manda sobre la etiqueta. Un rol de staff con tenant es un dato incoherente, no un pase.
  if (user.role !== CLIENT_ROLE) {
    logger.error(
      { userId: user.id, role: user.role, tenantId: user.tenantId },
      "[client scope] usuario con tenant y rol distinto de client: confinado al portal"
    );
  }

  if (!isClientAllowed(req.method, fullPath)) {
    return res.status(403).json({ error: "Acceso no permitido" });
  }

  next();
}
