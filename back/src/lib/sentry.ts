import * as Sentry from "@sentry/node";
import { logger } from "./logger";

let enabled = false;

/**
 * Initializes Sentry only when SENTRY_DSN is set. Without a DSN this is a no-op,
 * so local/dev runs are unaffected and the integration "turns on" in deploy by
 * just defining the env var.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info("Sentry deshabilitado (SENTRY_DSN no definido)");
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
  enabled = true;
  logger.info("Sentry inicializado");
}

/** Sends an error to Sentry when enabled; no-op otherwise. */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
