import type { SessionUser } from "@/lib/auth";

// Augmenta Express.Request con los campos que el código añade en runtime,
// para evitar `(req as any)` por toda la base de código.
declare global {
  namespace Express {
    interface Request {
      /** Usuario de sesión inyectado por el gate de autenticación. */
      user?: SessionUser;
      /** Cuerpo crudo capturado por express.json verify (HMAC de webhooks). */
      rawBody?: Buffer;
      /** Datos validados por los middlewares de `@/lib/http` (validate.*). */
      validatedBody?: unknown;
      validatedQuery?: unknown;
      validatedParams?: unknown;
    }
  }
}

export {};
