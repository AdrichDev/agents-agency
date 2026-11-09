/**
 * S7 (model-catalog) — `GET /api/models`: el catálogo que consumen los selectores.
 *
 * Devuelve proveedores → modelos `{id, name, provider, reasoning, efforts, defaultEffort,
 * contextWindow, verified}`, sin precios ni claves. Es la ÚNICA superficie del catálogo: el front
 * de AA (T3) y el CRM dejan sus listas a mano y piden esto, con la estática como respaldo si la
 * llamada falla.
 *
 * Autenticación, y por qué está aquí y no en el gate de `/api`:
 *
 * El gate de `index.ts` resuelve la sesión del panel ANTES de decidir si una ruta es pública, así
 * que si dejara pasar esta ruta sin más (allowlist), el handler tendría que repetir la
 * verificación del token de Supabase. En cambio, si NO la dejara pasar, el token de servicio del
 * CRM —que no es una sesión— comería un 401 antes de llegar aquí. La solución es la excepción
 * `isCatalogPath` en el gate (pasar siempre, con `req.user` ya resuelto si lo había) y esta
 * compuerta, que exige usuario del panel o el token de servicio del CRM. Un solo sitio decide, y
 * es el que tiene la información: `req.user` ya está calculado.
 *
 * El token es el MISMO que abre `/api/ai/generate` (`AA_SERVICE_TOKEN`, en `Authorization:
 * Bearer`): el CRM ya lo tiene y no hace falta repartir un segundo secreto. Sin token configurado
 * no se abre nada (fail-closed, igual que `isServiceCall`).
 */
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { buildCatalogResponse } from "@/lib/llm/catalog-sources";

export const modelsRouter = Router();

/** Ruta exacta que el gate de `/api` deja pasar para que se autentique aquí. */
const CATALOG_PATH = "/api/models";

/**
 * ¿Es la lectura del catálogo? La usa el gate de `index.ts` como excepción a la puerta de sesión.
 * Sólo `GET /api/models`: nada más nace abierto por este cambio.
 */
export function isCatalogPath(method: string, path: string): boolean {
  return method === "GET" && path.split("?")[0] === CATALOG_PATH;
}

/** Comparación en tiempo constante: el token es un secreto y el tiempo de respuesta no. */
function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Usuario del panel (sesión ya resuelta por el gate) o token de servicio del CRM. Cualquier otra
 * cosa es 401 con el mismo cuerpo que el resto de `/api`, para no decirle a nadie qué le falta.
 */
export function modelsCatalogAuth(req: Request, res: Response, next: NextFunction) {
  if (req.user) return next();

  const authHeader = req.headers.authorization ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const expected = process.env.AA_SERVICE_TOKEN ?? "";

  if (expected && provided && tokensEqual(provided, expected)) return next();

  return res.status(401).json({ error: "No autenticado" });
}

modelsRouter.get("/", modelsCatalogAuth, (_req: Request, res: Response) => {
  res.json(buildCatalogResponse());
});
