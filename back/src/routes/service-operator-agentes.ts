import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireOperatorToken } from "@/lib/operator-token";

// ---------------------------------------------------------------------------
// Superficie de LECTURA de agentes del Operator Agent (T1, odd/tasks/
// mcp-plataforma-read-surface, S1/S5/S8).
//
// Router PROPIO (S8.2), montado en src/index.ts bajo el mismo prefijo
// /service/operator que el resto del operador y protegido por el MISMO
// middleware requireOperatorToken (S8.1): no hay auth nueva, no se toca el gate
// de sesión Supabase ni PUBLIC_RULES/SERVICE_RULES.
//
// Qué NO hace y por qué:
//   · No usa `listAgents()` (S8.6): ese servicio arrastra tenant, integrations,
//     canales y contadores, y esta superficie solo necesita la ficha del agente.
//   · No usa `include` ni acepta nombres de columna del cliente (S8.3): el
//     `select` sale de AGENTE_CAMPOS, una allowlist fija en el servidor. El
//     parámetro `campos` es un enum que se traduce aquí a columnas canónicas.
//   · No expone prompt de sistema, configuración de widget, JSON de ecommerce,
//     clave pública, cupos ni knobs de comportamiento (S8.5): es lo que puede
//     llevar un secreto, una credencial o configuración interna.
//
// Solo lectura: aquí no se declara ninguna ruta de escritura.
// ---------------------------------------------------------------------------

/** Techo duro de filas por página (S8.4). */
const LIMITE_MAX = 100;
/** Tamaño de página por defecto. */
const LIMITE_DEFECTO = 20;
/** Tope de caracteres de un valor de query que viaja a la auditoría. */
const RECORTE_AUDITORIA = 120;

/**
 * Allowlist de campos legibles y su columna Prisma canónica (S8.3).
 *
 * La clave es lo que el cliente pide en `campos` (y lo que ve en la respuesta);
 * el valor es la columna real. Añadir una columna aquí es la ÚNICA forma de que
 * salga por esta superficie, y el test golden de claves se pone rojo si alguien
 * mete una nueva sin decidirlo.
 */
const AGENTE_CAMPOS = {
  id: "id",
  name: "name",
  sector: "sector",
  status: "status",
  runtime: "runtime",
  model: "model",
  channel: "channel",
  publishedAt: "publishedAt",
  statusChangedAt: "statusChangedAt",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  tenantId: "tenantId",
} as const;

type AgenteCampo = keyof typeof AGENTE_CAMPOS;

/** Proyección compacta por defecto: cabe mucha fila por respuesta. */
const CAMPOS_POR_DEFECTO: readonly AgenteCampo[] = [
  "id",
  "name",
  "sector",
  "status",
  "runtime",
  "model",
  "createdAt",
  "updatedAt",
];

/** Columnas del modelo Agent que esta superficie NO puede devolver jamás (S8.5). */
const COLUMNAS_PROHIBIDAS = [
  "systemPrompt",
  "widgetTemplateConfig",
  "widgetAvatarBase64",
  "widgetAvatarUrl",
  "widgetPrimaryColor",
  "widgetSecondaryColor",
  "widgetAvatarEmoji",
  "widgetInstalledAt",
  "widgetLastSeenAt",
  "ecommerceConfig",
  "publicKey",
  "tokenQuotaOverride",
  "inboundBufferMs",
  "replyMaxMessages",
  "replySplitPauseMs",
  "temperature",
  "reasoningEffort",
] as const;

/**
 * Construye el `select` de Prisma a partir de la allowlist. `campos` ya viene
 * validado contra AGENTE_CAMPOS, así que aquí no puede entrar una columna
 * arbitraria: el mapeo es siempre clave del enum → valor de AGENTE_CAMPOS.
 */
function selectDe(campos: readonly AgenteCampo[]): Record<string, true> {
  const select: Record<string, true> = {};
  for (const campo of campos) select[AGENTE_CAMPOS[campo]] = true;
  return select;
}

/** Proyección del detalle: todo el allowlist (nunca las prohibidas). */
const AGENTE_SELECT_DETALLE = selectDe(Object.keys(AGENTE_CAMPOS) as AgenteCampo[]);

/** Único campo ordenable hoy (S8.4): el que responde "el último agente creado". */
const ORDER_BY = z.enum(["createdAt"]);
const DIR = z.enum(["asc", "desc"]);
const CAMPOS_ENUM = z.enum(Object.keys(AGENTE_CAMPOS) as [AgenteCampo, ...AgenteCampo[]]);

/**
 * Query del listado. `.strict()` es deliberado: Zod descarta en silencio las
 * claves que no conoce, así que sin él un `?systemPrompt=x` o un `?select=...`
 * daría 200 y quien lo probara creería que el parámetro se aceptó.
 */
const listQuerySchema = z
  .object({
    // Techo duro, no recorte: pedir más de 100 es un 400 explícito.
    limit: z.coerce.number().int().min(1).max(LIMITE_MAX).default(LIMITE_DEFECTO),
    offset: z.coerce.number().int().min(0).default(0),
    orderBy: ORDER_BY.default("createdAt"),
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

/** Valor de query listo para la auditoría: texto corto, nunca cabeceras. */
function valorAuditoria(valor: unknown): string | undefined {
  if (typeof valor === "string") return valor.slice(0, RECORTE_AUDITORIA);
  if (Array.isArray(valor)) return valor.join(",").slice(0, RECORTE_AUDITORIA);
  return undefined;
}

/**
 * Una línea de auditoría por lectura (S8.8). Se engancha ANTES del middleware
 * de token y a `res.on("finish")`, así que el 401 también queda auditado: una
 * lectura, una línea, con ruta, paginación pedida y resultado.
 *
 * Lo que viaja: ruta, paginación y estado. Lo que NUNCA viaja: el token, las
 * cabeceras, el cuerpo de la respuesta ni ninguna columna de configuración.
 */
function auditoriaLectura(): RequestHandler {
  return (req: Request, res: Response, next) => {
    const inicio = Date.now();
    res.on("finish", () => {
      logger.info(
        {
          // `req.path` es "/" en la raíz del router: se evita el "/" final para
          // que la línea se lea como la ruta real del endpoint.
          ruta: `${req.method} ${req.baseUrl}${req.path === "/" ? "" : req.path}`,
          limit: valorAuditoria(req.query.limit),
          offset: valorAuditoria(req.query.offset),
          orderBy: valorAuditoria(req.query.orderBy),
          dir: valorAuditoria(req.query.dir),
          campos: valorAuditoria(req.query.campos),
          resultado: res.statusCode < 400 ? "ok" : "error",
          statusCode: res.statusCode,
          ms: Date.now() - inicio,
        },
        "[service-operator-agentes] lectura de agentes"
      );
    });
    next();
  };
}

export const serviceOperatorAgentesRouter = Router();

// Auditoría primero (para que el 401 deje su línea) y después el MISMO
// middleware de autenticación que protege /service/operator: fail-closed,
// comparación en tiempo constante, sin scopes nuevos.
serviceOperatorAgentesRouter.use(auditoriaLectura());
serviceOperatorAgentesRouter.use(requireOperatorToken());

/**
 * GET /agentes — listado paginado de agentes.
 *
 * S5 ("cuál fue el último agente que creamos") se responde con
 * `?orderBy=createdAt&dir=desc&limit=1` en UNA sola llamada.
 */
export async function listAgentesOperadorHandler(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Parámetros de consulta no válidos", detalle: parsed.error.flatten() },
    });
  }
  const { limit, offset, orderBy, dir, campos } = parsed.data;

  try {
    const [agentes, total] = await Promise.all([
      prisma.agent.findMany({
        select: selectDe(campos ?? CAMPOS_POR_DEFECTO),
        orderBy: { [orderBy]: dir },
        skip: offset,
        take: limit,
      }),
      prisma.agent.count({ where: {} }),
    ]);
    res.json({
      agentes,
      total,
      limit,
      offset,
      hasMore: offset + agentes.length < total,
    });
  } catch (e) {
    logger.error({ err: e }, "[service-operator-agentes] error listando agentes:");
    res.status(500).json({ error: "No se pudieron cargar los agentes" });
  }
}

/** GET /agentes/:id — ficha de un agente, o 404. */
export async function getAgenteOperadorHandler(req: Request, res: Response) {
  const query = detalleQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Parámetros de consulta no admitidos", detalle: query.error.flatten() },
    });
  }
  const id = idParamSchema.safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Id no válido" } });
  }

  try {
    const agente = await prisma.agent.findUnique({
      where: { id: id.data },
      select: AGENTE_SELECT_DETALLE,
    });
    if (!agente) return res.status(404).json({ error: "Agente no encontrado" });
    res.json(agente);
  } catch (e) {
    logger.error({ err: e }, "[service-operator-agentes] error cargando agente:");
    res.status(500).json({ error: "No se pudo cargar el agente" });
  }
}

/* ---------- Rutas (sólo lectura) ---------- */

serviceOperatorAgentesRouter.get("/", listAgentesOperadorHandler);
serviceOperatorAgentesRouter.get("/:id", getAgenteOperadorHandler);

// Referencia viva para el golden de S8.5: quien lea este archivo ve, en el mismo
// sitio, qué columnas existen en Agent y cuáles están vetadas aquí.
export const AGENTE_COLUMNAS_PROHIBIDAS: readonly string[] = COLUMNAS_PROHIBIDAS;
