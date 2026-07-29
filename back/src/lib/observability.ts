import type { Request, Response, NextFunction } from "express";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { logger } from "./logger";
import { captureError } from "./sentry";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Per-request structured logging + correlation id. Assigns/propagates
 * `x-request-id`, attaches `req.log`, and tags each completed request with a
 * level based on its status code.
 *
 * En dev, `autoLogging` se desactiva para mantener la terminal limpia (solo se
 * ve el banner de arranque). Los errores 5xx siguen apareciendo vía errorHandler.
 * En producción se loguea cada request (salvo health probes) para los shippers.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = (req.headers["x-request-id"] as string) || randomUUID();
    res.setHeader("x-request-id", id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  autoLogging: isDev
    ? false
    : {
        ignore: (req) => req.url === "/health" || req.url === "/ready",
      },
});

// Draining flag: durante el apagado, readiness pasa a 503 para que un
// balanceador deje de enrutar tráfico antes de cerrar.
let draining = false;
export function setDraining(value: boolean) {
  draining = value;
}

/**
 * Commit que construyó este proceso, en corto. Render lo inyecta como `RENDER_GIT_COMMIT`;
 * `GIT_COMMIT` queda como escotilla para cualquier otro sitio donde se despliegue esto.
 *
 * Se resuelve una vez al cargar el módulo y no en cada petición: es inmutable durante la vida
 * del proceso, y ese es justo el punto — lo que se quiere saber es qué código está sirviendo.
 *
 * Se publican 7 caracteres, no el SHA entero. Basta para identificar el despliegue contra el
 * historial y no es un identificador completo puesto ahí para que lo copie cualquiera.
 */
const COMMIT = (process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "").slice(0, 7);

/**
 * Liveness: the process is up and serving. Cheap, no dependencies touched.
 *
 * Devuelve también el commit desplegado. Sin esto no había forma de comprobar desde fuera QUÉ
 * versión estaba sirviendo producción: un `uptime` que sube y un push reciente encajan igual con
 * un despliegue nuevo que con un reinicio del contenedor viejo, y una coincidencia temporal no es
 * una verificación. Con `commit`, la pregunta se contesta con un `curl`.
 *
 * `commit` se omite si el entorno no lo informa (desarrollo local), en vez de mandar una cadena
 * vacía que se lee como «no hay commit» en lugar de «nadie lo ha dicho».
 */
export function healthHandler(_req: Request, res: Response) {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    ...(COMMIT ? { commit: COMMIT } : {}),
  });
}

/** Readiness: the process can serve traffic (DB reachable, not draining). */
export async function readyHandler(_req: Request, res: Response) {
  if (draining) {
    return res.status(503).json({ status: "draining" });
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ready", db: "up" });
  } catch (err) {
    logger.error({ err }, "readiness check failed: database unreachable");
    res.status(503).json({ status: "not-ready", db: "down" });
  }
}

/** Unknown /api route → JSON 404 (keeps API responses consistent). */
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Not Found" });
}

/**
 * Centralized error handler (must be the LAST middleware). Logs with the
 * request-scoped logger when available and returns a safe JSON body — internal
 * error details are never leaked to clients on 5xx.
 */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = Number(err?.status ?? err?.statusCode) || 500;
  const log = req.log ?? logger;
  log.error({ err, status }, "unhandled request error");

  // Solo errores de servidor (5xx) van a Sentry; los 4xx son esperables.
  if (status >= 500) captureError(err, { requestId: req.id, status });

  if (res.headersSent) return;
  const isClient = status >= 400 && status < 500;

  // Envelope consistente: `error` siempre string. `code`/`details` solo en 4xx
  // (en 5xx se devuelve genérico para no filtrar detalles internos).
  const body: { error: string; code?: string; details?: unknown; requestId?: string } = {
    error: isClient && typeof err?.message === "string" ? err.message : "Error interno del servidor",
    requestId: req.id ? String(req.id) : undefined,
  };
  if (isClient) {
    if (err?.code) body.code = err.code;
    if (err?.details !== undefined) body.details = err.details;
  }
  res.status(status).json(body);
}
