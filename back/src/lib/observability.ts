import type { Request, Response, NextFunction } from "express";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { logger } from "./logger";

/**
 * Per-request structured logging + correlation id. Assigns/propagates
 * `x-request-id`, attaches `req.log`, and tags each completed request with a
 * level based on its status code. Health probes are not logged to avoid noise.
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
  autoLogging: {
    ignore: (req) => req.url === "/health" || req.url === "/ready",
  },
});

// Draining flag: durante el apagado, readiness pasa a 503 para que un
// balanceador deje de enrutar tráfico antes de cerrar.
let draining = false;
export function setDraining(value: boolean) {
  draining = value;
}

/** Liveness: the process is up and serving. Cheap, no dependencies touched. */
export function healthHandler(_req: Request, res: Response) {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
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
  const log = (req as any).log ?? logger;
  log.error({ err, status }, "unhandled request error");

  if (res.headersSent) return;
  const isClient = status >= 400 && status < 500;

  // Envelope consistente: `error` siempre string. `code`/`details` solo en 4xx
  // (en 5xx se devuelve genérico para no filtrar detalles internos).
  const body: { error: string; code?: string; details?: unknown; requestId?: string } = {
    error: isClient && typeof err?.message === "string" ? err.message : "Error interno del servidor",
    requestId: (req as any).id,
  };
  if (isClient) {
    if (err?.code) body.code = err.code;
    if (err?.details !== undefined) body.details = err.details;
  }
  res.status(status).json(body);
}
