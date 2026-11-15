import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireOperatorToken } from "@/lib/operator-token";
import {
  metaDePagina,
  paginacionInvalida,
  parsearPaginacion,
} from "@/lib/operator-read-pagination";
import { auditoriaLectura, errorValidacion } from "@/lib/operator-read-domains";

// ---------------------------------------------------------------------------
// Superficie de LECTURA de canales del Operator Agent (T7, odd/tasks/
// mcp-plataforma-read-surface, S1/S8/S11).
//
// Router PROPIO, montado en src/index.ts bajo /service/operator/canales y
// protegido por el MISMO middleware requireOperatorToken (S8.1): no hay auth
// nueva y no se toca el gate de sesión Supabase ni PUBLIC_RULES/SERVICE_RULES.
//
// Qué NO hace y por qué (S8.5/S11):
//   · Proyección FIJA en el servidor: credentials y webhookSecret nunca se
//     seleccionan y nunca se descifra nada en este camino (no hay
//     phoneNumberIdMasked ni webhookUrl).
//   · `metadata` se lee SÓLO para derivar `managedBy` y se descarta: el objeto
//     crudo nunca sale en la respuesta. `agentName` se omite a propósito (el
//     select fijo no lo incluye y no hace falta leer la relación del agente).
//   · `statusDetail` se trunca a 120 caracteres en el servidor.
//
// Sólo lectura: aquí no se declara ninguna ruta de escritura.
// ---------------------------------------------------------------------------

/** Tope de caracteres del detalle de estado (texto de error del proveedor). */
const RECORTE_STATUS_DETAIL = 120;

/**
 * Select fijo de la superficie (S8.3). Incluye `metadata` internamente sólo para
 * derivar `managedBy`; el DTO de salida lo descarta. NUNCA incluye `credentials`
 * ni `webhookSecret`.
 */
const CANAL_SELECT = {
  id: true,
  agentId: true,
  provider: true,
  status: true,
  statusDetail: true,
  botName: true,
  botUsername: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Columnas que esta superficie no puede devolver jamás. */
const COLUMNAS_PROHIBIDAS = ["credentials", "webhookSecret", "metadata"] as const;

type FilaCanal = {
  id: string;
  agentId: string;
  provider: string;
  status: string;
  statusDetail: string | null;
  botName: string | null;
  botUsername: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function truncarStatusDetail(detalle: string | null | undefined): string | null {
  if (detalle == null) return null;
  return detalle.slice(0, RECORTE_STATUS_DETAIL);
}

function managedByDe(metadata: unknown): string | null {
  const m = (metadata ?? {}) as Record<string, unknown>;
  return typeof m.managedBy === "string" ? m.managedBy : null;
}

/** DTO de salida: las 10 claves del contrato, sin credentials/webhookSecret/metadata. */
function aDto(fila: FilaCanal) {
  return {
    id: fila.id,
    agentId: fila.agentId,
    provider: fila.provider,
    status: fila.status,
    statusDetail: truncarStatusDetail(fila.statusDetail),
    botName: fila.botName,
    botUsername: fila.botUsername,
    managedBy: managedByDe(fila.metadata),
    createdAt: fila.createdAt,
    updatedAt: fila.updatedAt,
  };
}

/** Query estricta: sólo limit/offset. Cualquier otro parámetro es un 400. */
const listQuerySchema = z
  .object({
    limit: z.unknown().optional(),
    offset: z.unknown().optional(),
  })
  .strict();

const idParamSchema = z.string().trim().min(1).max(64);

export const serviceOperatorCanalesRouter = Router();

// Auditoría primero (para que el 401 deje su línea) y después el MISMO
// middleware de autenticación que protege /service/operator.
serviceOperatorCanalesRouter.use(
  auditoriaLectura("[service-operator-canales] lectura de canales")
);
serviceOperatorCanalesRouter.use(requireOperatorToken());

/**
 * GET / — listado cross-agent paginado de conexiones de canal, con select fijo.
 */
export async function listCanalesOperadorHandler(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json(
      errorValidacion("Parámetros de consulta no válidos", parsed.error.flatten())
    );
  }
  const pag = parsearPaginacion(parsed.data as unknown as Record<string, unknown>);
  if (!pag.ok) {
    return res.status(400).json(paginacionInvalida(pag.detalle));
  }

  const { limit, offset } = pag;

  try {
    const [filas, total] = await Promise.all([
      prisma.channelConnection.findMany({
        select: CANAL_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      prisma.channelConnection.count({ where: {} }),
    ]);
    const canales = (filas as unknown as FilaCanal[]).map(aDto);
    res.json({ canales, ...metaDePagina({ total, devueltos: canales.length, limit, offset }) });
  } catch (e) {
    logger.error({ err: e }, "[service-operator-canales] error listando canales:");
    res.status(500).json({ error: "No se pudieron cargar los canales" });
  }
}

/**
 * GET /:agentId — mismas filas filtradas por agente, con el mismo sobre de
 * paginación. 404 cuando el agente no tiene conexiones.
 */
export async function getCanalesAgenteOperadorHandler(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json(
      errorValidacion("Parámetros de consulta no válidos", parsed.error.flatten())
    );
  }
  const pag = parsearPaginacion(parsed.data as unknown as Record<string, unknown>);
  if (!pag.ok) {
    return res.status(400).json(paginacionInvalida(pag.detalle));
  }
  const id = idParamSchema.safeParse(req.params.agentId);
  if (!id.success) {
    return res.status(400).json(errorValidacion("Id no válido", id.error.flatten()));
  }

  const { limit, offset } = pag;

  try {
    const [filas, total] = await Promise.all([
      prisma.channelConnection.findMany({
        where: { agentId: id.data },
        select: CANAL_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      prisma.channelConnection.count({ where: { agentId: id.data } }),
    ]);
    if (total === 0) {
      return res.status(404).json({ error: "El agente no tiene canales conectados" });
    }
    const canales = (filas as unknown as FilaCanal[]).map(aDto);
    res.json({ canales, ...metaDePagina({ total, devueltos: canales.length, limit, offset }) });
  } catch (e) {
    logger.error({ err: e }, "[service-operator-canales] error cargando canales del agente:");
    res.status(500).json({ error: "No se pudieron cargar los canales del agente" });
  }
}

/* ---------- Rutas (sólo lectura) ---------- */

serviceOperatorCanalesRouter.get("/", listCanalesOperadorHandler);
serviceOperatorCanalesRouter.get("/:agentId", getCanalesAgenteOperadorHandler);

// Referencia viva para el golden de S8.5: qué columnas quedan vetadas aquí.
// `metadata` se lee internamente para derivar `managedBy`, pero nunca se expone.
export const CANAL_COLUMNAS_PROHIBIDAS: readonly string[] = COLUMNAS_PROHIBIDAS;
