import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireOperatorToken } from "@/lib/operator-token";
import { searchKnowledge } from "@/lib/embeddings";
import {
  metaDePagina,
  paginacionInvalida,
  parsearPaginacion,
} from "@/lib/operator-read-pagination";
import { auditoriaLectura, errorValidacion, valorAuditoria } from "@/lib/operator-read-domains";

// ---------------------------------------------------------------------------
// Superficie de LECTURA de conocimiento del Operator Agent (T7, odd/tasks/
// mcp-plataforma-read-surface, S1/S8/S11).
//
// Router PROPIO, montado en src/index.ts bajo /service/operator/conocimiento y
// protegido por el MISMO middleware requireOperatorToken (S8.1): no hay auth
// nueva y no se toca el gate de sesión Supabase ni PUBLIC_RULES/SERVICE_RULES.
//
// Qué NO hace y por qué (S11):
//   · No expone `embedding` ni el contenido completo (solo snippet <= 200).
//   · No expone subida de ficheros, ingesta, scrape, DELETE de fuentes ni
//     ecommerceConfig/ingest-status: aquí no hay ninguna ruta de escritura.
//   · No duplica la lógica RAG: /buscar reusa `searchKnowledge` tal cual.
//
// Sólo lectura: aquí no se declara ninguna ruta de escritura.
// ---------------------------------------------------------------------------

/** Longitud máxima del snippet que se expone de cada resultado de búsqueda. */
const RECORTE_SNIPPET = 200;

/** Query de GET /fuentes. `.strict()` rechaza cualquier parámetro no listado. */
const fuentesQuerySchema = z
  .object({
    agentId: z.string().trim().min(1).max(128),
    // limit/offset se validan con el helper compartido (1..200 / >= 0), no aquí.
    limit: z.unknown().optional(),
    offset: z.unknown().optional(),
    orderBy: z.enum(["source"]).default("source"),
  })
  .strict();

/** Query de GET /buscar. `k` acotado a [1,20] (default 5) y `query` a 1..2000. */
const buscarQuerySchema = z
  .object({
    agentId: z.string().trim().min(1).max(128),
    query: z.string().trim().min(1).max(2000),
    k: z.coerce.number().int().min(1).max(20).default(5),
  })
  .strict();

type FilaFuente = { source: string; chunks: number };
type FilaConteo = { total: number };

// ---------------------------------------------------------------------------
// Rate limiter local para /buscar (S11). `apiLimiter` cubre /api y esta ruta
// vive en /service/*, así que la búsqueda semántica (que gasta embeddings) lleva
// su propio límite pequeño por proceso. En memoria, sin dependencias externas,
// reseteable en tests.
// ---------------------------------------------------------------------------
const VENTANA_BUSQUEDA_MS = 60_000;
const LIMITE_BUSQUEDA_DEFECTO = 20;
let limiteBusquedaPorMinuto = LIMITE_BUSQUEDA_DEFECTO;
const marcasBusqueda: number[] = [];

const rateLimiterBusqueda: RequestHandler = (_req, res, next) => {
  const ahora = Date.now();
  const vivos = marcasBusqueda.filter((t) => ahora - t < VENTANA_BUSQUEDA_MS);
  marcasBusqueda.splice(0, marcasBusqueda.length, ...vivos);
  if (vivos.length >= limiteBusquedaPorMinuto) {
    return res.status(429).json({ error: "Demasiadas búsquedas. Inténtalo en un minuto." });
  }
  marcasBusqueda.push(ahora);
  next();
};

/** Sólo para tests: fija el límite por minuto del proceso actual. */
export function configurarRateLimiterBusqueda(limite: number) {
  limiteBusquedaPorMinuto = limite;
}

/** Sólo para tests: vacía el contador del proceso actual. */
export function resetRateLimiterBusqueda() {
  marcasBusqueda.splice(0, marcasBusqueda.length);
}

export const serviceOperatorConocimientoRouter = Router();

// Auditoría primero (para que el 401 deje su línea) y después el MISMO
// middleware de autenticación que protege /service/operator.
serviceOperatorConocimientoRouter.use(
  auditoriaLectura("[service-operator-conocimiento] lectura de conocimiento", (query) => ({
    orderBy: valorAuditoria(query.orderBy),
    k: valorAuditoria(query.k),
  }))
);
serviceOperatorConocimientoRouter.use(requireOperatorToken());

/**
 * GET /fuentes?agentId=... — fuentes indexadas de un agente con su nº de chunks,
 * paginadas en la base de datos.
 *
 * `groupBy` de Prisma no pagina (no admite skip/take/cursor), así que el conteo
 * de fuentes distintas y la página se resuelven con SQL crudo parametrizado
 * (S11): COUNT(DISTINCT fuente) + GROUP BY fuente con LIMIT/OFFSET. Nunca se
 * selecciona `contenido` ni `embedding`.
 */
export async function listarFuentesOperadorHandler(req: Request, res: Response) {
  const parsed = fuentesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json(
      errorValidacion("Parámetros de consulta no válidos", parsed.error.flatten())
    );
  }
  const pag = parsearPaginacion(parsed.data as unknown as Record<string, unknown>);
  if (!pag.ok) {
    return res.status(400).json(paginacionInvalida(pag.detalle));
  }

  const { agentId } = parsed.data;
  const { limit, offset } = pag;

  try {
    const [conteo, filas] = await Promise.all([
      prisma.$queryRaw<FilaConteo[]>`
        SELECT COUNT(DISTINCT "fuente")::int AS total
        FROM "aa"."fragmento_conocimiento"
        WHERE "agente_id" = ${agentId}
      `,
      prisma.$queryRaw<FilaFuente[]>`
        SELECT "fuente" AS source, COUNT(*)::int AS chunks
        FROM "aa"."fragmento_conocimiento"
        WHERE "agente_id" = ${agentId}
        GROUP BY "fuente"
        ORDER BY "fuente" ASC
        LIMIT ${limit} OFFSET ${offset}
      `,
    ]);
    const total = Number(conteo[0]?.total ?? 0);
    // Mapeo explícito: sólo source/chunks, nunca contenido ni embedding.
    const fuentes = filas.map((f) => ({ source: f.source, chunks: Number(f.chunks) }));
    res.json({ fuentes, ...metaDePagina({ total, devueltos: fuentes.length, limit, offset }) });
  } catch (e) {
    logger.error({ err: e }, "[service-operator-conocimiento] error listando fuentes:");
    res.status(500).json({ error: "No se pudieron cargar las fuentes" });
  }
}

/**
 * GET /buscar?agentId&query&k — búsqueda semántica acotada.
 *
 * Reusa `searchKnowledge` tal cual (nunca se duplica la lógica RAG/embeddings) y
 * aplica la MISMA proyección que routes/knowledge.ts:172-178: snippet <= 200 del
 * contenido y similarity = round((1 - distance) * 100). `total` es la longitud
 * realmente devuelta (si searchKnowledge devuelve menos de k, no se fabrica).
 */
export async function buscarConocimientoOperadorHandler(req: Request, res: Response) {
  const parsed = buscarQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json(
      errorValidacion("Parámetros de consulta no válidos", parsed.error.flatten())
    );
  }

  const { agentId, query, k } = parsed.data;

  try {
    const rows = await searchKnowledge(agentId, query, k);
    const resultados = rows.map((r) => ({
      source: r.source,
      snippet: r.content.slice(0, RECORTE_SNIPPET),
      similarity: Math.round((1 - r.distance) * 100),
    }));
    res.json({ total: resultados.length, resultados });
  } catch (e) {
    logger.error({ err: e }, "[service-operator-conocimiento] error buscando conocimiento:");
    res.status(500).json({ error: "No se pudo buscar en el conocimiento" });
  }
}

/* ---------- Rutas (sólo lectura) ---------- */

serviceOperatorConocimientoRouter.get("/fuentes", listarFuentesOperadorHandler);
serviceOperatorConocimientoRouter.get("/buscar", rateLimiterBusqueda, buscarConocimientoOperadorHandler);
