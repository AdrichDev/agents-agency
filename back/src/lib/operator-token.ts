import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Autenticación por service token del Operator Agent (F1 aa-operator-agent).
// El router /service/operator NO pasa por el gate de usuario (JWT Supabase):
// se protege SOLO con un token estático de servidor a servidor, un token por
// plataforma, env-only. El token NUNCA se loguea ni se devuelve en respuestas.
// ---------------------------------------------------------------------------

/** Comparación en tiempo constante (evita timing attacks sobre el token). */
function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Middleware: exige el header `x-service-token` y lo compara contra
 * OPERATOR_SERVICE_TOKEN en tiempo constante. Sin token configurado (env vacío),
 * header ausente o token que no coincide → 401 y no continúa. `injectedToken`
 * permite fijar el token esperado en tests sin tocar el entorno.
 */
export function requireOperatorToken(injectedToken?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const expected = injectedToken ?? process.env.OPERATOR_SERVICE_TOKEN ?? "";
    const provided = req.header("x-service-token") ?? "";
    // Sin token configurado no se abre nada por accidente (fail-closed).
    if (!expected || !provided || !tokensEqual(provided, expected)) {
      return res.status(401).json({ error: "No autorizado" });
    }
    next();
  };
}
