import type { Request, Response, NextFunction, RequestHandler } from "express";

export interface CacheOptions {
  /** Freshness window in seconds (Cache-Control max-age). */
  maxAge: number;
  /** Shared cache (proxy/CDN) may store it. Use only for non per-user data. Default: private. */
  public?: boolean;
  /** Serve stale up to N seconds while revalidating in the background. */
  staleWhileRevalidate?: number;
}

/** Builds a Cache-Control header value from options. */
export function buildCacheControl(opts: CacheOptions): string {
  const parts = [opts.public ? "public" : "private", `max-age=${Math.max(0, Math.floor(opts.maxAge))}`];
  if (opts.staleWhileRevalidate && opts.staleWhileRevalidate > 0) {
    parts.push(`stale-while-revalidate=${Math.floor(opts.staleWhileRevalidate)}`);
  }
  return parts.join(", ");
}

/**
 * Sets Cache-Control on a single response. Call it in the SUCCESS branch of a
 * handler so error responses are never cached.
 */
export function setCache(res: Response, opts: CacheOptions): Response {
  res.setHeader("Cache-Control", buildCacheControl(opts));
  return res;
}

/**
 * Route middleware that applies Cache-Control to GET responses only (other
 * methods are mutations and must not be cached). Use for routes whose GET is
 * always a successful, stable read.
 */
export function cacheControl(opts: CacheOptions): RequestHandler {
  const value = buildCacheControl(opts);
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET") res.setHeader("Cache-Control", value);
    next();
  };
}
