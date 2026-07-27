// Política de CORS (aa-widget-entrega-cross-origin).
//
// Extraído de index.ts por el mismo motivo que public-routes.ts: para poder
// testearlo sin arrancar el servidor entero, y para que el test monte ESTE
// middleware y no una reimplementación que puede divergir en silencio.
//
// Hay dos públicos incompatibles y por eso hay dos políticas:
//
//   - El PANEL vive en un dominio nuestro, manda cookie de sesión y necesita
//     `credentials: true`, que la especificación prohíbe combinar con
//     `Access-Control-Allow-Origin: *`.
//   - El WIDGET vive en el dominio del CLIENTE, que por definición no está en
//     ninguna allowlist nuestra, y no manda ni necesita cookie.
//
// Con una sola política, cualquier configuración correcta para uno rompe al otro.
import cors from "cors";
import type { RequestHandler } from "express";
import { isEmbeddable } from "@/lib/public-routes";

/**
 * Devuelve UN solo middleware que despacha por ruta, no dos encadenados.
 *
 * Encadenarlos parece equivalente y no lo es: `cors()` termina la respuesta en
 * el preflight, pero en la petición REAL pone las cabeceras y llama `next()`.
 * Con dos capas en cadena el preflight pasaba y la petición real caía en la
 * estricta con 403 — el widget seguía roto, sólo que un paso más tarde. Las dos
 * políticas son excluyentes y el código tiene que decirlo.
 *
 * `allowedOrigins` se inyecta en vez de leerse de `process.env` aquí dentro:
 * así el test fija la allowlist sin tocar variables de entorno globales, que en
 * una suite en paralelo se pisan entre ficheros.
 */
export function crearCorsPorRuta(allowedOrigins: Set<string>): RequestHandler {
  // SEGURIDAD: nunca `*`, siempre el origen reflejado.
  //
  // Fuera de la allowlist va SIN credenciales, lo que en seguridad equivale a
  // `*` — no viaja cookie, luego la respuesta no puede contener nada
  // autenticado — pero permite conservarlas DENTRO, que es lo que mantiene viva
  // la consola de operador (el front llama a /api/chat con sesión).
  //
  // De rebote aprieta el gate `test` de routes/ai.ts: sin cookie no se resuelve
  // `req.user`, y sin `req.user` no hay exención de metering desde una página
  // ajena. Abrir CORS aquí cierra esa puerta, no la abre.
  const abierto = cors((req, cb) => {
    const origin = req.headers.origin;
    cb(null, { origin: true, credentials: typeof origin === "string" && allowedOrigins.has(origin) });
  });

  const estricta = cors({
    origin: (origin, cb) => {
      // Sin origin (servidor a servidor) o fuera de producción, permitir.
      if (!origin || process.env.NODE_ENV !== "production" || allowedOrigins.has(origin)) {
        return cb(null, true);
      }
      // `status` explícito: sin él errorHandler asume 500 y además lo manda a
      // Sentry como avería del servidor. Un origen no permitido es un 403 del
      // cliente, no un fallo nuestro.
      cb(Object.assign(new Error("Origin no permitido por CORS"), { status: 403 }));
    },
    credentials: true,
  });

  return (req, res, next) => {
    // En un preflight el método real viaja en la cabecera, no en `req.method`
    // (que siempre es OPTIONS). Leerlo mal mandaría el preflight a la capa
    // estricta y el navegador nunca llegaría a emitir la petición real.
    const metodoReal =
      req.method === "OPTIONS"
        ? String(req.headers["access-control-request-method"] ?? "")
        : req.method;
    const ruta = req.originalUrl.split("?")[0];
    return isEmbeddable(metodoReal, ruta) ? abierto(req, res, next) : estricta(req, res, next);
  };
}
