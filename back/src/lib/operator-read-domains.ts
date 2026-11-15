import type { Request, RequestHandler, Response } from "express";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Helpers compartidos por las superficies de LECTURA de dominio del Operator
// Agent (T7, odd/tasks/mcp-plataforma-read-surface, S8/S11).
//
// Cada router de dominio repite el patrón de service-operator-agentes.ts
// (S8): auditoría ANTES del middleware de token, validación estricta de query y
// proyección fija en el servidor. Lo único que se comparte aquí es lo que no
// cambia entre dominios: el recorte del valor para la auditoría y la línea de
// auditoría en sí. Las allowlists y los esquemas de query son de cada dominio y
// viven en su propio router.
// ---------------------------------------------------------------------------

/** Tope de caracteres de un valor de query que viaja a la auditoría. */
export const RECORTE_AUDITORIA = 120;

/**
 * Valor de query listo para la auditoría: texto corto, nunca cabeceras.
 * Nunca se llama con el token ni con el cuerpo de la respuesta.
 */
export function valorAuditoria(valor: unknown): string | undefined {
  if (typeof valor === "string") return valor.slice(0, RECORTE_AUDITORIA);
  if (Array.isArray(valor)) return valor.join(",").slice(0, RECORTE_AUDITORIA);
  return undefined;
}

/**
 * Una línea de auditoría por lectura (S8.8). Se engancha ANTES del middleware
 * de token y a `res.on("finish")`, así que el 401 también queda auditado: una
 * lectura, una línea, con ruta, paginación pedida y resultado.
 *
 * La ruta y la query se CONGELAN en la entrada del middleware, no se leen al
 * terminar: `req.baseUrl`/`req.path` cambian mientras Express entra y sale de
 * routers, así que leerlos en `finish` puede capturar un prefijo prestado de
 * otro router en vez del endpoint real.
 *
 * Lo que viaja: ruta, paginación y estado (más los campos extra que pida cada
 * dominio). Lo que NUNCA viaja: el token, las cabeceras, el cuerpo de la
 * respuesta, el texto de la búsqueda ni ninguna columna de configuración.
 */
export function auditoriaLectura(
  etiqueta: string,
  extra: (query: Record<string, unknown>) => Record<string, unknown> = () => ({})
): RequestHandler {
  return (req: Request, res: Response, next) => {
    const inicio = Date.now();
    // `req.path` es "/" en la raíz del router: se evita el "/" final para que la
    // línea se lea como la ruta real del endpoint. Congelado aquí a propósito.
    const ruta = `${req.method} ${req.baseUrl}${req.path === "/" ? "" : req.path}`;
    const query = { ...(req.query as Record<string, unknown>) };
    res.on("finish", () => {
      logger.info(
        {
          ruta,
          limit: valorAuditoria(query.limit),
          offset: valorAuditoria(query.offset),
          ...extra(query),
          resultado: res.statusCode < 400 ? "ok" : "error",
          statusCode: res.statusCode,
          ms: Date.now() - inicio,
        },
        etiqueta
      );
    });
    next();
  };
}

/** Cuerpo de error 400 con la misma forma que el resto de la superficie. */
export function errorValidacion(message: string, detalle: unknown) {
  return {
    error: {
      code: "VALIDATION_ERROR",
      message,
      detalle,
    },
  };
}
