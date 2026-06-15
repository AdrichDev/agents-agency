import type { Request, Response, NextFunction, RequestHandler } from "express";
import { z, type ZodTypeAny } from "zod";

/**
 * Typed HTTP error. Any layer can throw it; the central errorHandler maps
 * `status`/`code`/`details` to the response envelope.
 */
export class HttpError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Wraps an async route handler so rejected promises / thrown errors are
 * forwarded to Express' error middleware instead of hanging the request.
 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Where parsed input is stashed for the downstream handler.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      validatedBody?: unknown;
      validatedQuery?: unknown;
      validatedParams?: unknown;
    }
  }
}

function makeValidator(source: "body" | "query" | "params") {
  return (schema: ZodTypeAny): RequestHandler =>
    (req, _res, next) => {
      const result = schema.safeParse((req as any)[source] ?? {});
      if (!result.success) {
        return next(
          new HttpError(400, "Datos inválidos", "VALIDATION_ERROR", result.error.flatten())
        );
      }
      (req as any)[
        source === "body" ? "validatedBody" : source === "query" ? "validatedQuery" : "validatedParams"
      ] = result.data;
      next();
    };
}

/** Zod validation middleware factories. On failure → HttpError(400, VALIDATION_ERROR). */
export const validate = {
  body: makeValidator("body"),
  query: makeValidator("query"),
  params: makeValidator("params"),
};

export { z };
