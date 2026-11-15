import { Router, type Request, type RequestHandler, type Response } from "express";
import { logger } from "@/lib/logger";
import { requireOperatorToken } from "@/lib/operator-token";
import { consumirPendiente, descartarPendiente } from "@/lib/operator-confirmations";
import { accionDeEscritura } from "@/routes/service-operator";

// ---------------------------------------------------------------------------
// Confirmación HUMANA de las escrituras del Operator Agent
// (odd/tasks/mcp-plataforma-read-surface, T8b, S4/S14).
//
// Router PROPIO montado en /service/operator/confirmaciones y protegido por el
// MISMO middleware requireOperatorToken (S8.1): no hay auth nueva, no se toca el
// gate de sesión Supabase ni PUBLIC_RULES/SERVICE_RULES, y no se abre ninguna
// ruta pública.
//
// El token llega desde el chat de Telegram (callback_data del botón que envió el
// backend) y lo presenta el agente al llamar a estas rutas. Un token es de UN
// solo uso: se consume ANTES de ejecutar, así que un replay nunca ejecuta dos
// veces, y si caducó (10 minutos) no ejecuta nada.
//
// Aquí NO hay lógica de negocio: se ejecuta la MISMA definición que usaría el
// handler original (routes/service-operator.ts, ACCIONES_ESCRITURA), así que la
// edición/borrado/creación se comporta igual que antes, con su propia auditoría.
//
// Auditoría: una línea por petición, como el resto de routers de dominio, con la
// ruta ENMASCARADA (`:token`). El token no viaja nunca al log.
// ---------------------------------------------------------------------------

const ETIQUETA_AUDITORIA = "[service-operator-confirmaciones] confirmación de escritura del operador";

/**
 * Una línea por petición. La ruta se congela en la entrada y el segmento del
 * token se sustituye por `:token`: el token NUNCA se escribe en el log, ni en la
 * ruta ni en ningún campo.
 */
const auditoriaConfirmacion: RequestHandler = (req, res, next) => {
  const inicio = Date.now();
  const ruta = `${req.method} ${req.baseUrl}${req.path.replace(/^\/[^/]+/, "/:token")}`;
  res.on("finish", () => {
    logger.info(
      {
        ruta,
        // Sólo se conoce la acción cuando el token era válido (nunca el token).
        accion: res.locals.accionConfirmada,
        resultado: res.statusCode < 400 ? "ok" : "error",
        statusCode: res.statusCode,
        ms: Date.now() - inicio,
      },
      ETIQUETA_AUDITORIA
    );
  });
  next();
};

/** Respuesta de token desconocido o ya usado (incluye el replay). */
function noEncontrada(res: Response) {
  return res.status(404).json({
    error: {
      code: "confirmacion_no_encontrada",
      message: "No hay ninguna acción pendiente con ese identificador. Vuelve a pedirla.",
    },
  });
}

/** Respuesta de token caducado (nada se ejecuta). */
function caducada(res: Response) {
  return res.status(410).json({
    error: {
      code: "confirmacion_caducada",
      message: "La confirmación ha caducado; la acción no se ha ejecutado. Vuelve a pedirla.",
    },
  });
}

export const serviceOperatorConfirmacionesRouter = Router();

// Auditoría primero (para que el 401 deje su línea) y después el MISMO
// middleware de autenticación que protege /service/operator.
serviceOperatorConfirmacionesRouter.use(auditoriaConfirmacion);
serviceOperatorConfirmacionesRouter.use(requireOperatorToken());

/**
 * POST /:token/confirmar — ejecuta la acción pendiente, una sola vez.
 *
 * El consumo del token es la barrera anti-replay: ocurre ANTES de ejecutar, así
 * que dos peticiones simultáneas o repetidas nunca ejecutan dos veces la misma
 * acción. La respuesta es la del handler original (201 alta, 200 edición/baja).
 */
export async function confirmarAccionHandler(req: Request, res: Response) {
  const consumo = consumirPendiente(req.params.token);
  if (consumo.estado === "desconocido") return noEncontrada(res);
  if (consumo.estado === "caducado") return caducada(res);

  const definicion = accionDeEscritura(consumo.pendiente.accion);
  if (!definicion) return noEncontrada(res);

  res.locals.accionConfirmada = consumo.pendiente.accion;

  try {
    await definicion.ejecutar({
      payload: consumo.pendiente.payload,
      params: consumo.pendiente.params,
      origen: consumo.pendiente.origen,
      res,
    });
  } catch (e) {
    // El handler de negocio ya responde sus propios errores; esto sólo cubre un
    // fallo inesperado que impida responder (nunca dos respuestas).
    logger.error({ err: e }, "[service-operator-confirmaciones] error ejecutando la acción confirmada:");
    if (!res.headersSent) res.status(500).json({ error: "No se pudo ejecutar la acción confirmada" });
  }
}

/** POST /:token/cancelar — descarta la acción pendiente sin ejecutar nada. */
export async function cancelarAccionHandler(req: Request, res: Response) {
  const descarte = descartarPendiente(req.params.token);
  if (descarte.estado === "desconocido") return noEncontrada(res);
  if (descarte.estado === "caducado") return caducada(res);

  res.locals.accionConfirmada = descarte.accion;
  res.json({ cancelada: true });
}

/* ---------- Rutas ---------- */

serviceOperatorConfirmacionesRouter.post("/:token/confirmar", confirmarAccionHandler);
serviceOperatorConfirmacionesRouter.post("/:token/cancelar", cancelarAccionHandler);
