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
import { auditoriaLectura, errorValidacion, valorAuditoria } from "@/lib/operator-read-domains";

// ---------------------------------------------------------------------------
// Superficie de LECTURA de landings del Operator Agent (T7, odd/tasks/
// mcp-plataforma-read-surface, S1/S8/S11).
//
// Router PROPIO, montado en src/index.ts bajo /service/operator/landings y
// protegido por el MISMO middleware requireOperatorToken (S8.1): no hay auth
// nueva y no se toca el gate de sesión Supabase ni PUBLIC_RULES/SERVICE_RULES.
//
// Qué NO hace y por qué (S8.3/S8.5/S11):
//   · No usa `include` ni acepta nombres de columna del cliente: el `select`
//     sale de LANDING_CAMPOS, una allowlist fija. `campos` es un enum que se
//     traduce aquí a columnas canónicas.
//   · No expone files, mobileFiles, answers, chatMessages, generationPrompt ni
//     ninguna columna de Tenant (business es un string, no una relación).
//
// Sólo lectura: aquí no se declara ninguna ruta de escritura.
// ---------------------------------------------------------------------------

/**
 * Allowlist del listado (S8.3). La clave es lo que el cliente pide en `campos`
 * (y lo que ve en la respuesta); el valor es la columna Prisma real. El detalle
 * añade `qrUrl` además de este allowlist.
 */
const LANDING_CAMPOS = {
  id: "id",
  name: "name",
  business: "business",
  status: "status",
  dbProvider: "dbProvider",
  mobileStack: "mobileStack",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
} as const;

type LandingCampo = keyof typeof LANDING_CAMPOS;

/** Proyección compacta por defecto: cabe mucha fila por respuesta. */
const CAMPOS_POR_DEFECTO: readonly LandingCampo[] = [
  "id",
  "name",
  "business",
  "status",
  "updatedAt",
];

/** Detalle = allowlist del listado + qrUrl (la URL editable del QR). */
const LANDING_DETALLE = { ...LANDING_CAMPOS, qrUrl: "qrUrl" } as const;

/** Columnas del modelo LandingProject que esta superficie NO puede devolver jamás. */
const COLUMNAS_PROHIBIDAS = [
  "files",
  "mobileFiles",
  "answers",
  "chatMessages",
  "generationPrompt",
] as const;

/** Construye el `select` del listado a partir de la allowlist. */
function selectDe(campos: readonly LandingCampo[]): Record<string, true> {
  const select: Record<string, true> = {};
  for (const campo of campos) select[LANDING_CAMPOS[campo]] = true;
  return select;
}

/** Construye el `select` del detalle (allowlist + qrUrl). */
function selectDetalle(): Record<string, true> {
  const select: Record<string, true> = {};
  for (const columna of Object.values(LANDING_DETALLE)) select[columna] = true;
  return select;
}

const ORDER_BY = z.enum(["updatedAt", "createdAt"]);
const DIR = z.enum(["asc", "desc"]);
const CAMPOS_ENUM = z.enum(Object.keys(LANDING_CAMPOS) as [LandingCampo, ...LandingCampo[]]);

/**
 * Query del listado. `.strict()` es deliberado: un `?files=x` o un `?select=...`
 * debe dar 400, no un 200 silencioso.
 */
const listQuerySchema = z
  .object({
    // limit/offset se validan con el helper compartido (1..200 / >= 0).
    limit: z.unknown().optional(),
    offset: z.unknown().optional(),
    orderBy: ORDER_BY.default("updatedAt"),
    dir: DIR.default("desc"),
    campos: z
      .string()
      .trim()
      .min(1, "campos no puede estar vacío")
      .transform((s) => s.split(",").map((c) => c.trim()).filter(Boolean))
      .pipe(z.array(CAMPOS_ENUM).min(1).max(CAMPOS_ENUM.options.length))
      .optional(),
  })
  .strict();

/** El detalle no acepta query: cualquier parámetro es un 400. */
const detalleQuerySchema = z.object({}).strict();

const idParamSchema = z.string().trim().min(1).max(64);

export const serviceOperatorLandingsRouter = Router();

// Auditoría primero (para que el 401 deje su línea) y después el MISMO
// middleware de autenticación que protege /service/operator.
serviceOperatorLandingsRouter.use(
  auditoriaLectura("[service-operator-landings] lectura de landings", (query) => ({
    orderBy: valorAuditoria(query.orderBy),
    dir: valorAuditoria(query.dir),
    campos: valorAuditoria(query.campos),
  }))
);
serviceOperatorLandingsRouter.use(requireOperatorToken());

/**
 * GET / — listado paginado de landings, ordenable y con proyección seleccionable.
 */
export async function listLandingsOperadorHandler(req: Request, res: Response) {
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

  const { orderBy, dir, campos } = parsed.data;
  const { limit, offset } = pag;

  try {
    const [landings, total] = await Promise.all([
      prisma.landingProject.findMany({
        select: selectDe(campos ?? CAMPOS_POR_DEFECTO),
        orderBy: [{ [orderBy]: dir }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      prisma.landingProject.count({ where: {} }),
    ]);
    res.json({ landings, ...metaDePagina({ total, devueltos: landings.length, limit, offset }) });
  } catch (e) {
    logger.error({ err: e }, "[service-operator-landings] error listando landings:");
    res.status(500).json({ error: "No se pudieron cargar las landings" });
  }
}

/** GET /:id — ficha de una landing (allowlist completa + qrUrl), o 404. */
export async function getLandingOperadorHandler(req: Request, res: Response) {
  const query = detalleQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json(
      errorValidacion("Parámetros de consulta no admitidos", query.error.flatten())
    );
  }
  const id = idParamSchema.safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json(
      errorValidacion("Id no válido", id.error.flatten())
    );
  }

  try {
    const landing = await prisma.landingProject.findUnique({
      where: { id: id.data },
      select: selectDetalle(),
    });
    if (!landing) return res.status(404).json({ error: "Landing no encontrada" });
    res.json(landing);
  } catch (e) {
    logger.error({ err: e }, "[service-operator-landings] error cargando landing:");
    res.status(500).json({ error: "No se pudo cargar la landing" });
  }
}

/* ---------- Rutas (sólo lectura) ---------- */

serviceOperatorLandingsRouter.get("/", listLandingsOperadorHandler);
serviceOperatorLandingsRouter.get("/:id", getLandingOperadorHandler);

// Referencia viva para el golden de S8.5: qué columnas del modelo quedan vetadas.
export const LANDING_COLUMNAS_PROHIBIDAS: readonly string[] = COLUMNAS_PROHIBIDAS;
