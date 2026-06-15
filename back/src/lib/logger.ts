import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Structured application logger (pino). Pretty-prints in development, emits
 * single-line JSON in production (ready for log shippers / Sentry breadcrumbs).
 * Sensitive fields are redacted so tokens and passwords never reach the logs.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
    ],
    censor: "[redacted]",
  },
});
