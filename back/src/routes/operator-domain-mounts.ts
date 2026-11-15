import type { Express } from "express";
import { serviceOperatorRouter } from "@/routes/service-operator";
import { serviceOperatorAgentesRouter } from "@/routes/service-operator-agentes";
import { serviceOperatorConocimientoRouter } from "@/routes/service-operator-conocimiento";
import { serviceOperatorLandingsRouter } from "@/routes/service-operator-landings";
import { serviceOperatorCanalesRouter } from "@/routes/service-operator-canales";
import { serviceOperatorConfirmacionesRouter } from "@/routes/service-operator-confirmaciones";
import {
  serviceOperatorFacturasRouter,
  serviceOperatorPresupuestosRouter,
} from "@/routes/service-operator-facturas";

// ---------------------------------------------------------------------------
// Composición ÚNICA de la superficie del Operator Agent (T7 B1, S8.8).
//
// Vive aquí y no en src/index.ts porque el ORDEN de montaje es parte del
// contrato: es lo único que decide si el 401 temprano de una ruta de dominio
// deja su línea de auditoría o muere en silencio detrás del token del router
// legacy. src/index.ts y los tests llaman a esta misma función, así que el orden
// probado no puede divergir del de producción.
//
// Por qué los routers de dominio van ANTES del legacy: ambos comparten el mismo
// requireOperatorToken, pero el legacy lo aplica con `router.use()`, así que
// cualquier ruta que entre por ahí sin token responde 401 antes de alcanzar el
// router de dominio — y ese 401 se perdería sin auditoría. Montando primero el
// router de dominio, su auditoría (enganchada a `res.on("finish")` ANTES de su
// propio token) cubre también el 401, y el legacy nunca ve esas rutas: sus
// lecturas y escrituras no reciben ninguna línea nueva.
//
// Los prefijos no colisionan: el legacy declara estado/agenda/clientes/leads/
// agentes/contactos y los dominios declaran conocimiento/landings/canales/
// confirmaciones (S14)/facturas/presupuestos (S17).
//
// S17: /facturas es el ÚNICO segmento compartido a propósito entre los dos
// mundos — la LECTURA (GET) vive en el router de dominio y la ESCRITURA (POST
// agencia_crear_factura) en el legacy. Como los routers de dominio van antes, el
// GET lo resuelve el de dominio y el POST (que no declara ruta en el dominio) cae
// al legacy. Está fijado en tests/service-operator-mount-audit.test.ts.
// ---------------------------------------------------------------------------

/** Prefijo común de toda la superficie del operador (fuera de /api). */
export const PREFIJO_OPERADOR = "/service/operator";

/**
 * Routers de dominio con auditoría propia. Se montan ANTES de
 * `serviceOperatorRouter`; cada uno audita su petición exactamente una vez,
 * incluido el 401 de su `requireOperatorToken`.
 */
export const MONTAJES_DOMINIO = [
  { segmento: "conocimiento", router: serviceOperatorConocimientoRouter },
  { segmento: "landings", router: serviceOperatorLandingsRouter },
  { segmento: "canales", router: serviceOperatorCanalesRouter },
  // S17: presupuestos y facturas del panel (sólo lectura; la escritura vive en el legacy).
  { segmento: "presupuestos", router: serviceOperatorPresupuestosRouter },
  { segmento: "facturas", router: serviceOperatorFacturasRouter },
  // S14: confirmación humana de las escrituras (los botones los envía el backend).
  { segmento: "confirmaciones", router: serviceOperatorConfirmacionesRouter },
] as const;

/**
 * Monta la superficie del operador en el orden de producción. Se llama una sola
 * vez desde src/index.ts y desde los tests de composición.
 */
export function montarSuperficieOperador(app: Express) {
  for (const { segmento, router } of MONTAJES_DOMINIO) {
    app.use(`${PREFIJO_OPERADOR}/${segmento}`, router);
  }
  app.use(PREFIJO_OPERADOR, serviceOperatorRouter);
  app.use(`${PREFIJO_OPERADOR}/agentes`, serviceOperatorAgentesRouter);
}
