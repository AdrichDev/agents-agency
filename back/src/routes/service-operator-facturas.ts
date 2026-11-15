import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireOperatorToken } from "@/lib/operator-token";
import { totalPresupuestoConIva } from "@/lib/budgets";
import {
  metaDePagina,
  paginacionInvalida,
  parsearPaginacion,
} from "@/lib/operator-read-pagination";
import { auditoriaLectura, errorValidacion } from "@/lib/operator-read-domains";

// ---------------------------------------------------------------------------
// Superficie de LECTURA de facturas y presupuestos del Operator Agent (S17,
// odd/tasks/mcp-plataforma-read-surface, L29).
//
// Routers PROPIOS (mismo patrón que landings/canales/agentes), montados en
// routes/operator-domain-mounts.ts bajo /service/operator/facturas y
// /service/operator/presupuestos, y protegidos por el MISMO middleware
// requireOperatorToken: no hay auth nueva, no se toca el gate de sesión Supabase
// ni PUBLIC_RULES/SERVICE_RULES.
//
// Qué NO hace y por qué (la factura es un registro de dinero, riesgo item 1):
//   · No usa `include` ni acepta nombres de columna del cliente: el `select` es
//     fijo y sólo pide lo que proyecta la respuesta. La respuesta son DTOs
//     construidos aquí, así que ningún campo nuevo del schema se filtra solo.
//   · No expone ids, snapshots (clientSnapshot/issuerSnapshot), líneas, notas,
//     vatRate ni el presupuesto/factura completo: `clientName` sustituye al id
//     (S16: el bot nunca dice ids) y los importes se reducen al total con IVA ya
//     calculado server-side.
//   · No escribe nada.
//
// Compatibilidad con la escritura (S17): POST /service/operator/facturas es una
// ruta del router legacy (agencia_crear_factura). Este router se monta ANTES y
// sólo declara GET, así que la lectura no tapa a la escritura ni al revés; para
// que la escritura que cae por aquí camino del legacy no deje una línea de
// auditoría de LECTURA falsa, la auditoría de estas rutas sólo se engancha a
// métodos de lectura.
// ---------------------------------------------------------------------------

/** Query admitida: sólo paginación. Cualquier otro parámetro es un 400. */
const listQuerySchema = z
  .object({
    limit: z.unknown().optional(),
    offset: z.unknown().optional(),
  })
  .strict();

/**
 * Auditoría de lectura: una línea por LECTURA. En este router convive una
 * escritura del router legacy en el mismo segmento, y una escritura no es una
 * lectura: aquí no se audita (ya deja su propia fila al ejecutarse).
 */
function auditoriaDeLectura(etiqueta: string): RequestHandler {
  const auditar = auditoriaLectura(etiqueta);
  return (req, res, next) =>
    req.method === "GET" || req.method === "HEAD" ? auditar(req, res, next) : next();
}

/** Fecha a ISO (Prisma devuelve Date; se acepta string por robustez). */
function fechaIso(valor: unknown): string | null {
  if (!valor) return null;
  if (valor instanceof Date) return valor.toISOString();
  const fecha = new Date(String(valor));
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

/**
 * Nombre visible del cliente: el snapshot del presupuesto (lo que muestra el
 * panel) y, si está vacío, el nombre del tenant vinculado. Nunca el id.
 */
function nombreCliente(presupuesto: {
  clientSnapshot?: unknown;
  tenant?: { name?: string | null } | null;
}): string {
  const snapshot = presupuesto?.clientSnapshot;
  const delSnapshot =
    snapshot && typeof snapshot === "object" && typeof (snapshot as { name?: unknown }).name === "string"
      ? String((snapshot as { name: string }).name).trim()
      : "";
  return delSnapshot || presupuesto?.tenant?.name || "";
}

/** Proyección FIJA de una factura: nada de ids, snapshots, líneas ni notas. */
const FACTURA_SELECT = {
  number: true,
  status: true,
  createdAt: true,
  paidAt: true,
  budget: {
    select: {
      totalImpl: true,
      totalMaint: true,
      clientSnapshot: true,
      tenant: { select: { name: true } },
    },
  },
} as const;

/** Proyección FIJA de un presupuesto (mismas reglas que la factura). */
const PRESUPUESTO_SELECT = {
  quoteNumber: true,
  status: true,
  createdAt: true,
  totalImpl: true,
  totalMaint: true,
  clientSnapshot: true,
  tenant: { select: { name: true } },
} as const;

/** Fila de Invoice + presupuesto → DTO del operador. */
function facturaDTO(fila: {
  number: string;
  status: string;
  createdAt: Date;
  paidAt: Date | null;
  budget: {
    totalImpl: number;
    totalMaint: number;
    clientSnapshot: unknown;
    tenant: { name: string } | null;
  } | null;
}) {
  return {
    number: fila.number,
    status: fila.status,
    total: totalPresupuestoConIva(fila.budget?.totalImpl ?? 0, fila.budget?.totalMaint ?? 0),
    clientName: nombreCliente(fila.budget ?? {}),
    createdAt: fechaIso(fila.createdAt),
    paidAt: fechaIso(fila.paidAt),
  };
}

/** Fila de Budget → DTO del operador. */
function presupuestoDTO(fila: {
  quoteNumber: string;
  status: string;
  createdAt: Date;
  totalImpl: number;
  totalMaint: number;
  clientSnapshot: unknown;
  tenant: { name: string } | null;
}) {
  return {
    quoteNumber: fila.quoteNumber,
    status: fila.status,
    total: totalPresupuestoConIva(fila.totalImpl, fila.totalMaint),
    clientName: nombreCliente(fila),
    createdAt: fechaIso(fila.createdAt),
  };
}

export const serviceOperatorFacturasRouter = Router();

// Auditoría primero (para que el 401 deje su línea) y después el MISMO
// middleware de autenticación que protege /service/operator.
serviceOperatorFacturasRouter.use(auditoriaDeLectura("[service-operator-facturas] lectura de facturas"));
serviceOperatorFacturasRouter.use(requireOperatorToken());

/** GET / — facturas paginadas (proyección fija), de la más reciente a la más antigua. */
export async function listFacturasOperadorHandler(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json(errorValidacion("Parámetros de consulta no válidos", parsed.error.flatten()));
  }
  const pag = parsearPaginacion(parsed.data as Record<string, unknown>);
  if (!pag.ok) return res.status(400).json(paginacionInvalida(pag.detalle));

  const { limit, offset } = pag;
  try {
    const [facturas, total] = await Promise.all([
      prisma.invoice.findMany({
        select: FACTURA_SELECT,
        // Desempate por id: dos facturas del mismo instante no bailan entre páginas.
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      prisma.invoice.count({ where: {} }),
    ]);
    res.json({
      facturas: facturas.map(facturaDTO),
      ...metaDePagina({ total, devueltos: facturas.length, limit, offset }),
    });
  } catch (e) {
    logger.error({ err: e }, "[service-operator-facturas] error listando facturas:");
    res.status(500).json({ error: "No se pudieron cargar las facturas" });
  }
}

serviceOperatorFacturasRouter.get("/", listFacturasOperadorHandler);

export const serviceOperatorPresupuestosRouter = Router();

serviceOperatorPresupuestosRouter.use(
  auditoriaDeLectura("[service-operator-presupuestos] lectura de presupuestos")
);
serviceOperatorPresupuestosRouter.use(requireOperatorToken());

/** GET / — presupuestos paginados (proyección fija), del más reciente al más antiguo. */
export async function listPresupuestosOperadorHandler(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json(errorValidacion("Parámetros de consulta no válidos", parsed.error.flatten()));
  }
  const pag = parsearPaginacion(parsed.data as Record<string, unknown>);
  if (!pag.ok) return res.status(400).json(paginacionInvalida(pag.detalle));

  const { limit, offset } = pag;
  try {
    const [presupuestos, total] = await Promise.all([
      prisma.budget.findMany({
        select: PRESUPUESTO_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      prisma.budget.count({ where: {} }),
    ]);
    res.json({
      presupuestos: presupuestos.map(presupuestoDTO),
      ...metaDePagina({ total, devueltos: presupuestos.length, limit, offset }),
    });
  } catch (e) {
    logger.error({ err: e }, "[service-operator-facturas] error listando presupuestos:");
    res.status(500).json({ error: "No se pudieron cargar los presupuestos" });
  }
}

serviceOperatorPresupuestosRouter.get("/", listPresupuestosOperadorHandler);
