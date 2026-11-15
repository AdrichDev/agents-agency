import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { nextClientCode, withCodeRetry } from "@/lib/codes";
import { convertSourceToTenant, AlreadyConvertedError } from "@/lib/convert-to-tenant";
import { createAgent } from "@/lib/agent/service";
import { requireOperatorToken } from "@/lib/operator-token";
import { writeOperatorAudit } from "@/lib/operator-audit";
import { registrarPendiente } from "@/lib/operator-confirmations";
import { getValidPlatformToken } from "@/lib/integrations/oauth";
import { createEvent, updateEvent, deleteEvent } from "@/lib/integrations/calendar";
import {
  listContactsHandler,
  createContactHandler,
  updateContactHandler,
  deleteContactHandler,
  createContactSchema,
  updateContactSchema,
  buildContactsWhere,
  listContactsQuerySchema,
} from "@/routes/contacts";
import {
  metaDePagina,
  paginacionInvalida,
  parsearPaginacion,
  pidePagina,
} from "@/lib/operator-read-pagination";

// ---------------------------------------------------------------------------
// Router del Operator Agent (F1 aa-operator-agent). Manos server-side de la
// plataforma agents-agency: estado, alta de cliente (tenant), conversión de
// lead → cliente y alta de agente. Protegido SOLO por el service token
// (x-service-token); montado FUERA de /api → no pasa por el gate de usuario.
//
// Protocolo de confirmación (S14, T8b): NINGUNA escritura se ejecuta en la
// primera llamada. El router valida el payload, guarda la acción como pendiente
// (lib/operator-confirmations.ts) y responde 202 { pendiente, accion, resumen,
// expiraEn } SIN token; el resumen y los botones Confirmar/Cancelar los envía el
// BACKEND a Telegram (nunca el modelo). Sólo la ruta de confirmaciones
// (routes/service-operator-confirmaciones.ts) ejecuta la lógica de negocio, y
// sólo con un token válido, vigente y sin usar. Por eso `confirmado`/`confirmar`
// en el body ya no autorizan nada: un modelo no puede confirmarse a sí mismo.
// Cada escritura ejecutada deja su fila de auditoría (fire-and-forget).
// ---------------------------------------------------------------------------

export const serviceOperatorRouter = Router();

// Todo el router exige el service token del operador.
serviceOperatorRouter.use(requireOperatorToken());

/** Origen de la orden para la auditoría (cabecera opcional; por defecto service-operator). */
function auditOrigin(req: Request): string {
  return req.header("x-operator-origin") ?? "service-operator";
}

/** `id` de la ruta como texto (seguro aunque el request sintético no lo traiga). */
function idDe(req: Request): string {
  const id = (req.params as Record<string, unknown> | undefined)?.id;
  return typeof id === "string" ? id : "";
}

/**
 * Payload sin los antiguos flags de auto-confirmación. Las escrituras cuyo body
 * valida zod ya los pierden al parsear; este helper cubre las que se guardan
 * tal cual (patch de cita): `confirmado`/`confirmar` no viajan a la ejecución.
 */
function sinFlagsDeConfirmacion(body: unknown): Record<string, unknown> {
  const origen = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const { confirmado: _confirmado, confirmar: _confirmar, ...resto } = origen;
  return resto;
}

/* ---------- GET /estado ---------- */

/**
 * Resumen operativo de la plataforma: nº de tenants activos, nº de agentes por
 * runtime y nº de leads pendientes (status "new"). Solo lectura → sin auditoría.
 */
export async function estadoHandler(_req: Request, res: Response) {
  try {
    const [tenantsActivos, agentesPorRuntime, leadsPendientes] = await Promise.all([
      prisma.tenant.count({ where: { isActive: true } }),
      prisma.agent.groupBy({ by: ["runtime"], _count: { _all: true } }),
      prisma.lead.count({ where: { status: "new" } }),
    ]);
    res.json({
      tenantsActivos,
      agentes: agentesPorRuntime.map((g) => ({ runtime: g.runtime, total: g._count._all })),
      leadsPendientes,
    });
  } catch (e) {
    logger.error({ err: e }, "[service-operator] error en estado:");
    res.status(500).json({ error: "No se pudo cargar el estado" });
  }
}

/* ---------- POST /clientes ---------- */

// Proyección de tenant que expone el operador: campos no sensibles + saldo de
// tokens (a Adrian le interesa el cupo). No hay secretos en el modelo Tenant.
const CLIENTE_SELECT = {
  id: true,
  codigo: true,
  name: true,
  razonSocial: true,
  nif: true,
  email: true,
  phone: true,
  contactPerson: true,
  website: true,
  sector: true,
  direccion: true,
  tokenBalance: true,
  tokensUsed: true,
  // H4 T3.3 — El panel tiene que mirar el MISMO contador que el gate. El cupo restante se
  // calcula contra el consumo del periodo; si el panel siguiera restando `tokensUsed` (el
  // acumulado de por vida), enseñaría "0 restantes" y la insignia BLOQUEADO a un cliente al que
  // el gate deja pasar perfectamente. `tokensUsed` se sigue enviando: es el histórico, y es
  // información útil, pero no es el cupo.
  tokensUsedPeriod: true,
  periodStart: true,
  // H4 T4 — `tokenBalance` de arriba es ya sólo el OVERRIDE. El cupo que aplica el gate sale del
  // plan cuando no hay override, así que sin el plan aquí este consumidor no puede reconstruir el
  // cupo real y volvería a enseñar cero a quien tiene tope de plan.
  plan: { select: { codigo: true, nombre: true, tokenQuotaPerAgent: true } },
  isActive: true,
  createdAt: true,
} as const;

// F6-T1: acepta TODOS los campos del tenant. Nombres de body en castellano
// (los que usa la tool MCP); se mapean a las props Prisma reales del schema
// (name/razonSocial/website/phone/contactPerson/tokenBalance). Se conservan
// `phone` y `contactPerson` como alias heredados para no romper llamadas previas.
const crearClienteSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio"),
  razonSocial: z.string().trim().optional(),
  nif: z.string().trim().optional(),
  direccion: z.string().trim().optional(),
  sector: z.string().trim().optional(),
  sitioWeb: z.string().trim().optional(),
  email: z.string().trim().email("Email no válido").optional(),
  telefono: z.string().trim().min(1).optional(),
  contacto: z.string().trim().optional(),
  saldoTokens: z.number().int().min(0).optional(),
  // Alias heredados (compatibilidad).
  phone: z.string().trim().min(1).optional(),
  contactPerson: z.string().trim().optional(),
});

/**
 * Alta de tenant ("cliente general"). Reusa la convención de creación de tenant
 * del repo (código secuencial cli-NN + withCodeRetry, ver routes/contacts.ts).
 */
export async function crearClienteHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  const parsed = crearClienteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  try {
    const tenant = await withCodeRetry(async () =>
      prisma.tenant.create({
        data: {
          codigo: await nextClientCode(),
          name: data.nombre,
          razonSocial: data.razonSocial ?? null,
          nif: data.nif ?? null,
          direccion: data.direccion ?? null,
          sector: data.sector ?? null,
          website: data.sitioWeb ?? null,
          email: data.email ?? null,
          phone: data.telefono ?? data.phone ?? null,
          contactPerson: data.contacto ?? data.contactPerson ?? null,
          ...(data.saldoTokens !== undefined && { tokenBalance: data.saldoTokens }),
        },
      })
    );
    writeOperatorAudit({
      accion: "agencia_crear_cliente",
      payload: { nombre: data.nombre },
      origen,
      resultado: "ok",
      detalle: tenant.id,
    });
    res.status(201).json({ id: tenant.id, codigo: tenant.codigo, name: tenant.name });
  } catch (e) {
    logger.error({ err: e }, "[service-operator] error creando cliente:");
    writeOperatorAudit({
      accion: "agencia_crear_cliente",
      payload: { nombre: data.nombre },
      origen,
      resultado: "error",
      detalle: "create_failed",
    });
    res.status(500).json({ error: "No se pudo crear el cliente" });
  }
}

/* ---------- POST /leads/:id/convertir ---------- */

/**
 * Convierte un Lead existente (lead de chatbot: customerName/email/phone) en un
 * tenant. El modelo Lead no tiene FK a tenant, así que la conversión crea el
 * tenant con los datos del lead y marca el lead como "converted" (historial).
 */
export async function convertirLeadHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  const leadId = req.params.id;

  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
      writeOperatorAudit({
        accion: "agencia_convertir_lead",
        payload: { leadId },
        origen,
        resultado: "error",
        detalle: "lead_not_found",
      });
      return res.status(404).json({ error: "Lead no encontrado" });
    }
    if (lead.status === "converted") {
      // Ya convertido → no duplicar (chequeo rápido, fuera de la tx: evita abrir
      // una transacción para el caso común de un lead ya convertido hace tiempo).
      writeOperatorAudit({
        accion: "agencia_convertir_lead",
        payload: { leadId },
        origen,
        resultado: "error",
        detalle: "already_converted",
      });
      return res.status(409).json({ error: { code: "already_converted" } });
    }

    // Conversión atómica (código + create + update) vía el helper común.
    const tenant = await convertSourceToTenant({
      // Re-chequeo DENTRO de la tx: cierra la ventana TOCTOU frente a otra
      // request concurrente que convierta el mismo lead (ninguna ve el commit
      // de la otra en el chequeo previo a la transacción).
      alreadyConvertedCheck: async (tx) => {
        const fresh = await tx.lead.findUnique({ where: { id: leadId }, select: { status: true } });
        return fresh?.status === "converted";
      },
      buildTenantData: async (tx) => ({
        codigo: await nextClientCode(tx),
        name: lead.customerName,
        contactPerson: lead.customerName,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
      }),
      // El modelo Lead no guarda tenantId; marcamos el estado como convertido.
      linkSource: async (tx) => {
        await tx.lead.update({ where: { id: leadId }, data: { status: "converted" } });
      },
    });

    writeOperatorAudit({
      accion: "agencia_convertir_lead",
      payload: { leadId },
      origen,
      resultado: "ok",
      detalle: tenant.id,
    });
    res.status(201).json({ id: tenant.id, codigo: tenant.codigo, name: tenant.name, leadId });
  } catch (e) {
    if (e instanceof AlreadyConvertedError) {
      // Perdió la carrera: otra request concurrente ya lo convirtió dentro de
      // su transacción. Mismo desenlace/contrato que el chequeo rápido de arriba.
      writeOperatorAudit({
        accion: "agencia_convertir_lead",
        payload: { leadId },
        origen,
        resultado: "error",
        detalle: "already_converted",
      });
      return res.status(409).json({ error: { code: "already_converted" } });
    }
    logger.error({ err: e }, "[service-operator] error convirtiendo lead:");
    writeOperatorAudit({
      accion: "agencia_convertir_lead",
      payload: { leadId },
      origen,
      resultado: "error",
      detalle: "convert_failed",
    });
    res.status(500).json({ error: "No se pudo convertir el lead" });
  }
}

/* ---------- POST /agentes ---------- */

const crearAgenteSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio"),
  sector: z.string().trim().min(1, "El sector es obligatorio"),
  systemPrompt: z.string().trim().min(1, "El prompt de sistema es obligatorio"),
  runtime: z.enum(["openai", "openclaw"]).default("openai"),
});

/**
 * Alta de agente vía el servicio existente createAgent (sin cliente nuevo: el
 * operador crea el agente suelto). skillIds vacío por defecto.
 */
export async function crearAgenteHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  const parsed = crearAgenteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  try {
    const agent = await createAgent({
      name: data.name,
      sector: data.sector,
      systemPrompt: data.systemPrompt,
      runtime: data.runtime,
      skillIds: [],
      // F4: el backend de datos es obligatorio en createAgent. El operador crea
      // agentes informativos de forma EXPLÍCITA; capacidades se configuran
      // después en el panel del agente (F5).
      dataBackend: { mode: "none_yet" },
    });
    writeOperatorAudit({
      accion: "agencia_crear_agente",
      payload: { name: data.name, sector: data.sector },
      origen,
      resultado: "ok",
      detalle: agent.id,
    });
    res.status(201).json({
      id: agent.id,
      name: agent.name,
      sector: agent.sector,
      runtime: (agent as { runtime?: string }).runtime,
    });
  } catch (e) {
    logger.error({ err: e }, "[service-operator] error creando agente:");
    writeOperatorAudit({
      accion: "agencia_crear_agente",
      payload: { name: data.name },
      origen,
      resultado: "error",
      detalle: "create_failed",
    });
    res.status(500).json({ error: "No se pudo crear el agente" });
  }
}

/* ---------- CRUD de clientes (F6-T2) ---------- */

// Tenant NO tiene columna de soft-delete (deletedAt); su baja lógica es
// `isActive=false` (@map "activo"). Los listados solo muestran activos; el
// borrado sella isActive=false (recuperable con PATCH isActive:true).

/**
 * GET /clientes — lista clientes activos (proyección no sensible + saldo).
 *
 * Sin `limit`/`offset` responde el ARRAY de siempre. Con cualquiera de los dos
 * (S13) pagina en BD: skip/take + count con el MISMO where, orden estable
 * `createdAt desc, id asc` y sobre `{ clientes, total, limit, offset, hasMore,
 * nextOffset }`.
 */
export async function listClientesHandler(req: Request, res: Response) {
  const where = { isActive: true };

  if (pidePagina(req.query)) {
    const paginacion = parsearPaginacion(req.query);
    if (!paginacion.ok) return res.status(400).json(paginacionInvalida(paginacion.detalle));
    const { limit, offset } = paginacion;
    try {
      const [clientes, total] = await Promise.all([
        prisma.tenant.findMany({
          where,
          select: CLIENTE_SELECT,
          // Desempate por id: sin él, dos clientes creados en el mismo instante
          // pueden intercambiarse entre páginas (S13).
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: offset,
          take: limit,
        }),
        prisma.tenant.count({ where }),
      ]);
      return res.json({ clientes, ...metaDePagina({ total, devueltos: clientes.length, limit, offset }) });
    } catch (e) {
      logger.error({ err: e }, "[service-operator] error paginando clientes:");
      return res.status(500).json({ error: "No se pudieron cargar los clientes" });
    }
  }

  try {
    const clientes = await prisma.tenant.findMany({
      where,
      select: CLIENTE_SELECT,
      orderBy: { createdAt: "desc" },
    });
    res.json(clientes);
  } catch (e) {
    logger.error({ err: e }, "[service-operator] error listando clientes:");
    res.status(500).json({ error: "No se pudieron cargar los clientes" });
  }
}

/** GET /clientes/:id — detalle de un cliente. */
export async function getClienteHandler(req: Request, res: Response) {
  try {
    const cliente = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: CLIENTE_SELECT,
    });
    if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });
    res.json(cliente);
  } catch (e) {
    logger.error({ err: e }, "[service-operator] error cargando cliente:");
    res.status(500).json({ error: "No se pudo cargar el cliente" });
  }
}

// Edición: cualquier subconjunto de campos. `isActive` permite reactivar un
// cliente dado de baja (recuperación del soft-delete).
const editarClienteSchema = z.object({
  nombre: z.string().trim().min(1).optional(),
  razonSocial: z.string().trim().nullable().optional(),
  nif: z.string().trim().nullable().optional(),
  direccion: z.string().trim().nullable().optional(),
  sector: z.string().trim().nullable().optional(),
  sitioWeb: z.string().trim().nullable().optional(),
  email: z.string().trim().email("Email no válido").nullable().optional(),
  telefono: z.string().trim().nullable().optional(),
  contacto: z.string().trim().nullable().optional(),
  saldoTokens: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

/** PATCH /clientes/:id — edita un subconjunto de campos (confirmación humana aparte). */
export async function editarClienteHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  const id = req.params.id;
  const parsed = editarClienteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  try {
    const existing = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      writeOperatorAudit({
        accion: "agencia_editar_cliente",
        payload: { id },
        origen,
        resultado: "error",
        detalle: "cliente_not_found",
      });
      return res.status(404).json({ error: "Cliente no encontrado" });
    }

    const cliente = await prisma.tenant.update({
      where: { id },
      data: {
        ...(d.nombre !== undefined && { name: d.nombre }),
        ...(d.razonSocial !== undefined && { razonSocial: d.razonSocial }),
        ...(d.nif !== undefined && { nif: d.nif }),
        ...(d.direccion !== undefined && { direccion: d.direccion }),
        ...(d.sector !== undefined && { sector: d.sector }),
        ...(d.sitioWeb !== undefined && { website: d.sitioWeb }),
        ...(d.email !== undefined && { email: d.email }),
        ...(d.telefono !== undefined && { phone: d.telefono }),
        ...(d.contacto !== undefined && { contactPerson: d.contacto }),
        ...(d.saldoTokens !== undefined && { tokenBalance: d.saldoTokens }),
        ...(d.isActive !== undefined && { isActive: d.isActive }),
      },
      select: CLIENTE_SELECT,
    });
    writeOperatorAudit({
      accion: "agencia_editar_cliente",
      payload: { id },
      origen,
      resultado: "ok",
      detalle: id,
    });
    res.json(cliente);
  } catch (e) {
    logger.error({ err: e }, "[service-operator] error editando cliente:");
    writeOperatorAudit({
      accion: "agencia_editar_cliente",
      payload: { id },
      origen,
      resultado: "error",
      detalle: "update_failed",
    });
    res.status(500).json({ error: "No se pudo editar el cliente" });
  }
}

/** DELETE /clientes/:id — baja lógica (isActive=false); la confirmación humana es aparte. */
export async function borrarClienteHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  const id = req.params.id;

  try {
    // updateMany con filtro isActive:true → idempotente; count 0 si no existe
    // o ya estaba dado de baja.
    const { count } = await prisma.tenant.updateMany({
      where: { id, isActive: true },
      data: { isActive: false },
    });
    if (count === 0) {
      writeOperatorAudit({
        accion: "agencia_borrar_cliente",
        payload: { id },
        origen,
        resultado: "error",
        detalle: "cliente_not_found",
      });
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    writeOperatorAudit({
      accion: "agencia_borrar_cliente",
      payload: { id },
      origen,
      resultado: "ok",
      detalle: id,
    });
    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, "[service-operator] error borrando cliente:");
    writeOperatorAudit({
      accion: "agencia_borrar_cliente",
      payload: { id },
      origen,
      resultado: "error",
      detalle: "delete_failed",
    });
    res.status(500).json({ error: "No se pudo borrar el cliente" });
  }
}

/* ---------- CRUD de contactos (F6-T3) ---------- */

/**
 * Ejecuta un handler de contacts.ts (reuso directo de su lógica: soft-delete,
 * códigos pc-NN, contactedAt, etc.) y deja auditoría del operador según el
 * status resultante. Envuelve res para capturar el código sin duplicar lógica.
 */
async function delegateWithAudit(
  req: Request,
  res: Response,
  accion: string,
  payload: Record<string, unknown>,
  origen: string,
  handler: (r: Request, s: Response) => Promise<unknown> | unknown
): Promise<void> {
  let statusCode = 200;
  const proxy = {
    status(c: number) {
      statusCode = c;
      return this;
    },
    json(b: unknown) {
      res.status(statusCode).json(b);
      return this;
    },
  } as unknown as Response;

  await handler(req, proxy);

  const ok = statusCode < 400;
  writeOperatorAudit({
    accion,
    payload,
    origen,
    resultado: ok ? "ok" : "error",
    detalle: ok ? String(statusCode) : `status_${statusCode}`,
  });
}

/**
 * Proyección FIJA del listado paginado de contactos (S13). Son las mismas
 * columnas que ya devolvía el listado compartido —el contrato de campos que
 * consumen el MCP y el panel— pero expresadas como `select` explícito: el
 * llamador no puede pedir columnas, y `deletedAt` (soft delete) no viaja.
 */
const CONTACTO_SELECT = {
  id: true,
  codigo: true,
  name: true,
  phone: true,
  email: true,
  type: true,
  sector: true,
  direccion: true,
  peticion: true,
  contactado: true,
  contactedAt: true,
  tenantId: true,
  tenant: { select: { id: true, name: true, codigo: true } },
  createdAt: true,
} as const;

/**
 * GET /contactos — lista contactos (solo lectura).
 *
 * Sin `limit`/`offset` se delega TAL CUAL en el handler compartido del panel
 * (`contacts.listContactsHandler`), que es el que define soft-delete, filtros
 * `type`/`contactado` y el array legacy: ese camino no se toca.
 *
 * Con paginación se usa una ruta de lectura propia y acotada (S13): mismos
 * filtros y mismo contrato de campos, pero `select` fijo, skip/take + count en
 * BD, orden estable `createdAt desc, id asc` y sobre con metadatos.
 */
export async function operatorListContactosHandler(req: Request, res: Response) {
  if (!pidePagina(req.query)) return listContactsHandler(req, res);

  const paginacion = parsearPaginacion(req.query);
  if (!paginacion.ok) return res.status(400).json(paginacionInvalida(paginacion.detalle));

  // Filtros existentes, validados con el MISMO schema que usa el panel.
  const filtros = listContactsQuerySchema.safeParse({
    type: req.query.type || undefined,
    contactado: req.query.contactado || undefined,
  });
  if (!filtros.success) return res.status(400).json({ error: filtros.error.flatten() });

  const { limit, offset } = paginacion;
  const where = buildContactsWhere(filtros.data);
  try {
    const [contactos, total] = await Promise.all([
      prisma.prospectContact.findMany({
        where,
        select: CONTACTO_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      prisma.prospectContact.count({ where }),
    ]);
    res.json({ contactos, ...metaDePagina({ total, devueltos: contactos.length, limit, offset }) });
  } catch (e) {
    logger.error({ err: e }, "[service-operator] error paginando contactos:");
    res.status(500).json({ error: "No se pudieron cargar los contactos" });
  }
}

/** POST /contactos — crea un contacto (reuso de createContactHandler). */
export async function operatorCrearContactoHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  return delegateWithAudit(
    req,
    res,
    "agencia_crear_contacto",
    { name: (req.body as { name?: unknown } | null)?.name },
    origen,
    createContactHandler
  );
}

/** PATCH /contactos/:id — edita un contacto (reuso de updateContactHandler). */
export async function operatorEditarContactoHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  return delegateWithAudit(
    req,
    res,
    "agencia_editar_contacto",
    { id: req.params.id },
    origen,
    updateContactHandler
  );
}

/** DELETE /contactos/:id — baja lógica del contacto (reuso de deleteContactHandler). */
export async function operatorBorrarContactoHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  return delegateWithAudit(
    req,
    res,
    "agencia_borrar_contacto",
    { id: req.params.id },
    origen,
    deleteContactHandler
  );
}

/* ---------- Conversión Contacto → Cliente (F6-T4) ---------- */

// Campos que el contacto NO trae y el Minion pregunta antes de confirmar.
const convertirContactoSchema = z.object({
  razonSocial: z.string().trim().optional(),
  nif: z.string().trim().optional(),
  saldoTokens: z.number().int().min(0).optional(),
});

/**
 * Convierte UN contacto (contacto_prospecto) en cliente (tenant). Misma lógica
 * que contacts.convertToClientsHandler pero para un solo contacto y completando
 * los campos que el contacto no arrastra (razón social, NIF, saldo de tokens).
 * Crea el tenant con los datos del contacto, lo vincula (tenantId) y lo
 * soft-borra (deletedAt). Sustituye conceptualmente a la vieja conversión de
 * lead (que operaba sobre la tabla `lead`).
 */
export async function convertirContactoHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  const id = req.params.id;

  const parsed = convertirContactoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const extra = parsed.data;

  try {
    const contact = await prisma.prospectContact.findUnique({ where: { id } });
    if (!contact || contact.deletedAt) {
      writeOperatorAudit({
        accion: "agencia_convertir_contacto",
        payload: { contactId: id },
        origen,
        resultado: "error",
        detalle: "contact_not_found",
      });
      return res.status(404).json({ error: "Contacto no encontrado" });
    }
    if (contact.tenantId) {
      // Ya convertido → no duplicar (chequeo rápido, fuera de la tx: evita abrir
      // una transacción para el caso común de un contacto ya convertido hace tiempo).
      writeOperatorAudit({
        accion: "agencia_convertir_contacto",
        payload: { contactId: id },
        origen,
        resultado: "error",
        detalle: "already_converted",
      });
      return res.status(409).json({ error: { code: "already_converted" } });
    }

    // Conversión atómica (código + create + update) vía el helper común.
    const tenant = await convertSourceToTenant({
      // Re-chequeo DENTRO de la tx: cierra la ventana TOCTOU frente a otra
      // request concurrente que convierta el mismo contacto (ninguna ve el
      // commit de la otra en el chequeo previo a la transacción).
      alreadyConvertedCheck: async (tx) => {
        const fresh = await tx.prospectContact.findUnique({
          where: { id },
          select: { tenantId: true },
        });
        return !!fresh?.tenantId;
      },
      buildTenantData: async (tx) => ({
        codigo: await nextClientCode(tx),
        name: contact.name,
        contactPerson: contact.name,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        sector: contact.sector ?? null,
        direccion: contact.direccion ?? null,
        razonSocial: extra.razonSocial ?? null,
        nif: extra.nif ?? null,
        ...(extra.saldoTokens !== undefined && { tokenBalance: extra.saldoTokens }),
      }),
      // El contacto sale de la agenda: se vincula al cliente y se soft-borra.
      linkSource: async (tx, tenantId) => {
        await tx.prospectContact.update({
          where: { id },
          data: { tenantId, deletedAt: new Date() },
        });
      },
    });

    writeOperatorAudit({
      accion: "agencia_convertir_contacto",
      payload: { contactId: id },
      origen,
      resultado: "ok",
      detalle: tenant.id,
    });
    res.status(201).json({ id: tenant.id, codigo: tenant.codigo, name: tenant.name, contactId: id });
  } catch (e) {
    if (e instanceof AlreadyConvertedError) {
      // Perdió la carrera: otra request concurrente ya lo convirtió dentro de
      // su transacción. Mismo desenlace/contrato que el chequeo rápido de arriba.
      writeOperatorAudit({
        accion: "agencia_convertir_contacto",
        payload: { contactId: id },
        origen,
        resultado: "error",
        detalle: "already_converted",
      });
      return res.status(409).json({ error: { code: "already_converted" } });
    }
    logger.error({ err: e }, "[service-operator] error convirtiendo contacto:");
    writeOperatorAudit({
      accion: "agencia_convertir_contacto",
      payload: { contactId: id },
      origen,
      resultado: "error",
      detalle: "convert_failed",
    });
    res.status(500).json({ error: "No se pudo convertir el contacto" });
  }
}

/* ---------- GET /agenda y /agenda/huecos (aa-bot-agenda-citas-tool) ---------- */

// Ventana de atención por defecto para el cálculo de huecos libres. Cita de 30
// min (misma duración que /agenda). Reutilizable: si un tenant futuro necesita
// otro horario, se parametriza aquí sin tocar el contrato de la tool.
const AGENDA_SLOT_MIN = 30;
const AGENDA_OPEN_HOUR = 9;
const AGENDA_CLOSE_HOUR = 19;

/** Formatea una fecha local a YYYY-MM-DD / HH:MM (misma convención que /api/agenda). */
function agendaSlices(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    fecha: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hora: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/**
 * Resuelve el rango [desde, hasta] a partir de la query. Ambos en YYYY-MM-DD y
 * hora de pared. Si falta `hasta`, se asume el mismo día que `desde`. Si falta
 * `desde`, se asume hoy. Devuelve los límites como Date (inicio 00:00, fin
 * 23:59:59.999) o null si el formato es inválido.
 */
function resolveAgendaRange(q: Record<string, unknown>): { desde: Date; hasta: Date; desdeStr: string; hastaStr: string } | null {
  const isoDay = /^\d{4}-\d{2}-\d{2}$/;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hoyStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const desdeStr = typeof q.desde === "string" && isoDay.test(q.desde) ? q.desde : hoyStr;
  const hastaStr = typeof q.hasta === "string" && isoDay.test(q.hasta) ? q.hasta : desdeStr;
  if ((q.desde && !isoDay.test(String(q.desde))) || (q.hasta && !isoDay.test(String(q.hasta)))) return null;

  const desde = new Date(`${desdeStr}T00:00:00`);
  const hasta = new Date(`${hastaStr}T23:59:59.999`);
  if (isNaN(desde.getTime()) || isNaN(hasta.getTime()) || hasta < desde) return null;
  return { desde, hasta, desdeStr, hastaStr };
}

/** Filtro base de la agenda: citas no canceladas del rango (una sola definición). */
function agendaWhere(desde: Date, hasta: Date) {
  return { startAt: { gte: desde, lte: hasta }, status: { not: "Cancelada" } };
}

/** Citas no canceladas de la agenda de plataforma dentro de un rango. */
async function fetchAgendaAppointments(desde: Date, hasta: Date) {
  return prisma.platformAppointment.findMany({
    where: agendaWhere(desde, hasta),
    orderBy: { startAt: "asc" },
  });
}

/** Proyección FIJA de la ruta paginada: sólo las columnas que alimentan el DTO. */
const AGENDA_SELECT = { id: true, startAt: true, client: true, service: true, status: true } as const;

/** Fila de cita → shape que consumen las tools (`fecha`/`hora` en hora de pared). */
function citaAgendaDTO(a: { id: string; startAt: Date; client: string; service: string | null; status: string }) {
  return {
    id: a.id,
    ...agendaSlices(a.startAt),
    cliente: a.client,
    servicio: a.service ?? "",
    estado: a.status,
  };
}

/**
 * GET /agenda?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — lista las citas de la agenda
 * del owner (PlatformAppointment, espejo de Google Calendar) en el rango dado.
 * Solo lectura → sin auditoría. Fuente reutilizable para el bot de cada tenant.
 *
 * Sin `limit`/`offset` responde el objeto de siempre (`desde`, `hasta`, `total`,
 * `citas`) con `total` = número de filas del rango. Con cualquiera de los dos
 * (S13) pagina en BD sobre ese mismo rango y devuelve además `limit`, `offset`,
 * `hasMore` y `nextOffset`, con orden estable `startAt asc, id asc`.
 */
export async function agendaListarHandler(req: Request, res: Response) {
  const range = resolveAgendaRange(req.query as Record<string, unknown>);
  if (!range) return res.status(400).json({ error: "desde/hasta deben ser fechas YYYY-MM-DD válidas (hasta >= desde)" });

  if (pidePagina(req.query as Record<string, unknown>)) {
    const paginacion = parsearPaginacion(req.query as Record<string, unknown>);
    if (!paginacion.ok) return res.status(400).json(paginacionInvalida(paginacion.detalle));
    const { limit, offset } = paginacion;
    const where = agendaWhere(range.desde, range.hasta);
    try {
      const [rows, total] = await Promise.all([
        prisma.platformAppointment.findMany({
          where,
          select: AGENDA_SELECT,
          // Desempate por id: dos citas a la misma hora no deben bailar entre páginas.
          orderBy: [{ startAt: "asc" }, { id: "asc" }],
          skip: offset,
          take: limit,
        }),
        prisma.platformAppointment.count({ where }),
      ]);
      return res.json({
        desde: range.desdeStr,
        hasta: range.hastaStr,
        ...metaDePagina({ total, devueltos: rows.length, limit, offset }),
        citas: rows.map(citaAgendaDTO),
      });
    } catch (e) {
      logger.error({ err: e }, "[service-operator] error paginando agenda:");
      return res.status(500).json({ error: "No se pudo cargar la agenda" });
    }
  }

  try {
    const rows = await fetchAgendaAppointments(range.desde, range.hasta);
    res.json({
      desde: range.desdeStr,
      hasta: range.hastaStr,
      total: rows.length,
      citas: rows.map(citaAgendaDTO),
    });
  } catch (e) {
    logger.error({ err: e }, "[service-operator] error listando agenda:");
    res.status(500).json({ error: "No se pudo cargar la agenda" });
  }
}

/**
 * GET /agenda/huecos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — por cada día del rango,
 * cuántos huecos de 30 min quedan libres en horario 09:00–19:00 (huecos=0 → día
 * completo). Calcula sobre las citas de PlatformAppointment. Solo lectura.
 */
export async function agendaHuecosHandler(req: Request, res: Response) {
  const range = resolveAgendaRange(req.query as Record<string, unknown>);
  if (!range) return res.status(400).json({ error: "desde/hasta deben ser fechas YYYY-MM-DD válidas (hasta >= desde)" });
  try {
    const rows = await fetchAgendaAppointments(range.desde, range.hasta);

    // Índice de minutos-desde-medianoche ocupados por día (YYYY-MM-DD → Set).
    const ocupado = new Map<string, Set<number>>();
    for (const a of rows) {
      const { fecha } = agendaSlices(a.startAt);
      const startMin = a.startAt.getHours() * 60 + a.startAt.getMinutes();
      const durMs = a.endAt.getTime() - a.startAt.getTime();
      const durMin = durMs > 0 ? Math.round(durMs / 60000) : AGENDA_SLOT_MIN;
      if (!ocupado.has(fecha)) ocupado.set(fecha, new Set());
      const set = ocupado.get(fecha)!;
      // Marca cada slot de 30 min que solape con la cita.
      for (let m = startMin; m < startMin + durMin; m += AGENDA_SLOT_MIN) set.add(m - (m % AGENDA_SLOT_MIN));
    }

    const dias: Array<{ dia: string; huecos_libres: number }> = [];
    const cursor = new Date(range.desde);
    while (cursor <= range.hasta) {
      const { fecha } = agendaSlices(cursor);
      const set = ocupado.get(fecha) ?? new Set<number>();
      let libres = 0;
      for (let h = AGENDA_OPEN_HOUR * 60; h < AGENDA_CLOSE_HOUR * 60; h += AGENDA_SLOT_MIN) {
        if (!set.has(h)) libres++;
      }
      dias.push({ dia: fecha, huecos_libres: libres });
      cursor.setDate(cursor.getDate() + 1);
    }

    res.json({ desde: range.desdeStr, hasta: range.hastaStr, dias });
  } catch (e) {
    logger.error({ err: e }, "[service-operator] error calculando huecos de agenda:");
    res.status(500).json({ error: "No se pudieron calcular los huecos" });
  }
}

const AGENDA_ESTADOS = ["Confirmada", "Pendiente", "Completada", "Cancelada"] as const;

/** Campos validados de una cita nueva (fecha/hora en hora de pared). */
interface CitaNueva {
  fecha: string;
  hora: string;
  cliente: string;
  servicio?: string;
  notas?: string;
  duracion?: number;
}

/**
 * Validación ÚNICA de una cita nueva. La usan el handler de ejecución y la
 * preparación de la solicitud de confirmación, así que un body inválido se
 * rechaza con el MISMO 400 antes de molestar al humano con un botón inútil.
 */
function validarCitaNueva(body: unknown): { ok: true; cita: CitaNueva } | { ok: false; mensaje: string } {
  const { fecha, hora, cliente, servicio, notas, duracion } = (body ?? {}) as Record<string, unknown>;
  if (typeof fecha !== "string" || typeof hora !== "string" || typeof cliente !== "string" || !cliente.trim()) {
    return { ok: false, mensaje: "fecha (YYYY-MM-DD), hora (HH:MM) y cliente son obligatorios" };
  }
  if (isNaN(new Date(`${fecha}T${hora}`).getTime())) return { ok: false, mensaje: "fecha/hora inválidas" };
  return {
    ok: true,
    cita: {
      fecha,
      hora,
      cliente,
      servicio: typeof servicio === "string" ? servicio : undefined,
      notas: typeof notas === "string" ? notas : undefined,
      duracion: typeof duracion === "number" && duracion > 0 ? duracion : undefined,
    },
  };
}

/** Validación única del patch de una cita (hoy: `estado` dentro del enum). */
function validarCitaEdicion(body: unknown): { ok: true } | { ok: false; mensaje: string } {
  const { estado } = (body ?? {}) as Record<string, unknown>;
  if (estado !== undefined && !AGENDA_ESTADOS.includes(estado as (typeof AGENDA_ESTADOS)[number])) {
    return { ok: false, mensaje: `estado inválido; permitidos: ${AGENDA_ESTADOS.join(", ")}` };
  }
  return { ok: true };
}

/** Serializa una PlatformAppointment al shape que consumen las tools. */
function agendaCitaDTO(a: {
  id: string;
  startAt: Date;
  client: string;
  service: string | null;
  status: string;
  notes: string | null;
  gcalEventId: string | null;
}) {
  return {
    id: a.id,
    ...agendaSlices(a.startAt),
    cliente: a.client,
    servicio: a.service ?? "",
    estado: a.status,
    notas: a.notes ?? undefined,
  };
}

/** ¿Está conectada la integración de Google de plataforma? */
async function platformGoogleConnected() {
  return (await prisma.platformIntegration.findUnique({ where: { provider: "google" } })) != null;
}

/**
 * POST /agenda — crea una cita en la agenda del owner. Persiste SIEMPRE en BD y,
 * si el Calendar de plataforma está conectado, la replica en Google (best-effort).
 */
export async function agendaCrearHandler(req: Request, res: Response) {
  const validacion = validarCitaNueva(req.body);
  if (!validacion.ok) return res.status(400).json({ error: validacion.mensaje });
  const { fecha, hora, cliente, servicio, notas, duracion } = validacion.cita;
  const startAt = new Date(`${fecha}T${hora}`);
  const durMin = duracion ?? AGENDA_SLOT_MIN;
  const endAt = new Date(startAt.getTime() + durMin * 60_000);
  const service = servicio;
  const notes = notas;

  try {
    let gcalEventId: string | undefined;
    if (await platformGoogleConnected()) {
      try {
        const token = await getValidPlatformToken("google");
        const ev = await createEvent(token, {
          title: service ? `${cliente} - ${service}` : cliente,
          startIso: startAt.toISOString(),
          endIso: endAt.toISOString(),
          description: notes,
        });
        gcalEventId = ev.id;
      } catch (e) {
        logger.error({ err: e }, "[service-operator] no se pudo crear la cita en Google Calendar:");
      }
    }
    const created = await prisma.platformAppointment.create({
      data: { startAt, endAt, client: cliente, service, notes, gcalEventId },
    });
    res.status(201).json({ ok: true, cita: agendaCitaDTO(created) });
  } catch (e) {
    logger.error({ err: e }, "[service-operator] error creando cita:");
    res.status(500).json({ error: "No se pudo crear la cita" });
  }
}

/**
 * PATCH /agenda/:id — edita una cita (fecha/hora/cliente/servicio/notas/estado).
 * Sincroniza el cambio en Google best-effort si la cita ya está vinculada.
 */
export async function agendaEditarHandler(req: Request, res: Response) {
  const validacion = validarCitaEdicion(req.body);
  if (!validacion.ok) return res.status(400).json({ error: validacion.mensaje });
  const { fecha, hora, cliente, servicio, notas, estado } = (req.body ?? {}) as Record<string, unknown>;
  const existing = await prisma.platformAppointment.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Cita no encontrada" });

  const data: Record<string, unknown> = {};
  if (fecha !== undefined || hora !== undefined) {
    const slices = agendaSlices(existing.startAt);
    const startAt = new Date(`${(fecha as string) ?? slices.fecha}T${(hora as string) ?? slices.hora}`);
    if (isNaN(startAt.getTime())) return res.status(400).json({ error: "fecha/hora inválidas" });
    data.startAt = startAt;
    data.endAt = new Date(startAt.getTime() + (existing.endAt.getTime() - existing.startAt.getTime()));
  }
  if (typeof cliente === "string") data.client = cliente;
  if (typeof servicio === "string") data.service = servicio;
  if (typeof notas === "string") data.notes = notas;
  if (typeof estado === "string") data.status = estado;

  try {
    const updated = await prisma.platformAppointment.update({ where: { id: existing.id }, data });
    if (updated.gcalEventId && (await platformGoogleConnected())) {
      try {
        const token = await getValidPlatformToken("google");
        await updateEvent(token, updated.gcalEventId, {
          title: updated.service ? `${updated.client} - ${updated.service}` : updated.client,
          startIso: updated.startAt.toISOString(),
          endIso: updated.endAt.toISOString(),
          description: updated.notes ?? undefined,
        });
      } catch (e) {
        logger.error({ err: e }, "[service-operator] no se pudo actualizar la cita en Google Calendar:");
      }
    }
    res.json({ ok: true, cita: agendaCitaDTO(updated) });
  } catch (e) {
    logger.error({ err: e }, "[service-operator] error editando cita:");
    res.status(500).json({ error: "No se pudo editar la cita" });
  }
}

/**
 * DELETE /agenda/:id — borra una cita. Operación DESTRUCTIVA (elimina también el
 * evento real en Google Calendar). La confirmación es HUMANA y vive en el router
 * de confirmaciones (S14): este handler sólo ejecuta lo que ya confirmó una
 * persona, por eso ya no mira `confirmar` en query ni en body.
 */
export async function agendaBorrarHandler(req: Request, res: Response) {
  const existing = await prisma.platformAppointment.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Cita no encontrada" });

  try {
    if (existing.gcalEventId && (await platformGoogleConnected())) {
      try {
        const token = await getValidPlatformToken("google");
        await deleteEvent(token, existing.gcalEventId);
      } catch (e) {
        logger.error({ err: e }, "[service-operator] no se pudo borrar la cita en Google Calendar:");
      }
    }
    await prisma.platformAppointment.delete({ where: { id: existing.id } });
    res.json({ ok: true, borrada: existing.id });
  } catch (e) {
    logger.error({ err: e }, "[service-operator] error borrando cita:");
    res.status(500).json({ error: "No se pudo borrar la cita" });
  }
}

/* ---------- Escrituras con confirmación humana (S14 / T8b) ---------- */

/** Resultado de preparar una escritura: payload validado, o rechazo previo. */
type Preparacion =
  | { ok: true; payload: Record<string, unknown>; resumen: string }
  | { ok: false; status: number; body: unknown };

/** Contexto con el que se ejecuta una acción YA confirmada por una persona. */
export interface ContextoEjecucion {
  payload: Record<string, unknown>;
  params: Record<string, string>;
  origen: string;
  res: Response;
}

/**
 * Escritura del operador: cómo se valida/guarda (`preparar`) y cómo se ejecuta
 * (`ejecutar`). Ambas partes son la MISMA pieza de código que corría antes del
 * cambio: aquí no se duplica nada de la lógica de negocio.
 */
export interface AccionEscritura {
  preparar: (req: Request) => Preparacion | Promise<Preparacion>;
  ejecutar: (ctx: ContextoEjecucion) => Promise<void>;
}

/**
 * Request sintético para reusar TAL CUAL el handler de negocio cuando la
 * ejecución llega desde la confirmación humana: mismo body validado, mismos
 * params, mismo origen de auditoría y la `res` real de la petición de confirmar.
 */
function requestDeEjecucion(ctx: ContextoEjecucion): Request {
  return {
    body: ctx.payload,
    params: ctx.params,
    query: {},
    headers: {},
    header: (nombre: string) =>
      nombre.toLowerCase() === "x-operator-origin" ? ctx.origen : undefined,
  } as unknown as Request;
}

/** Rechazo previo con la misma forma que el resto del router. */
function rechazo(status: number, body: unknown): Preparacion {
  return { ok: false, status, body };
}

/**
 * Las DOCE escrituras, por nombre de acción (= nombre en la auditoría). El
 * router de confirmaciones busca aquí para ejecutar lo confirmado.
 */
const ACCIONES_ESCRITURA: Record<string, AccionEscritura> = {
  /* ---------- Clientes ---------- */
  agencia_crear_cliente: {
    preparar: (req) => {
      const parsed = crearClienteSchema.safeParse(req.body);
      if (!parsed.success) return rechazo(400, { error: parsed.error.flatten() });
      return {
        ok: true,
        payload: { ...parsed.data },
        resumen: `Crear el cliente «${parsed.data.nombre}»`,
      };
    },
    ejecutar: async (ctx) => {
      await crearClienteHandler(requestDeEjecucion(ctx), ctx.res);
    },
  },
  agencia_editar_cliente: {
    preparar: (req) => {
      const parsed = editarClienteSchema.safeParse(req.body);
      if (!parsed.success) return rechazo(400, { error: parsed.error.flatten() });
      const campos = Object.keys(parsed.data).join(", ");
      return {
        ok: true,
        payload: { ...parsed.data },
        resumen: `Editar el cliente ${idDe(req)}${campos ? ` (${campos})` : ""}`,
      };
    },
    ejecutar: async (ctx) => {
      await editarClienteHandler(requestDeEjecucion(ctx), ctx.res);
    },
  },
  agencia_borrar_cliente: {
    preparar: (req) => ({
      ok: true,
      payload: {},
      resumen: `Dar de baja (isActive=false) al cliente ${idDe(req)}`,
    }),
    ejecutar: async (ctx) => {
      await borrarClienteHandler(requestDeEjecucion(ctx), ctx.res);
    },
  },

  /* ---------- Leads ---------- */
  agencia_convertir_lead: {
    preparar: (req) => ({
      ok: true,
      payload: {},
      resumen: `Convertir el lead ${idDe(req)} en cliente`,
    }),
    ejecutar: async (ctx) => {
      await convertirLeadHandler(requestDeEjecucion(ctx), ctx.res);
    },
  },

  /* ---------- Agentes ---------- */
  agencia_crear_agente: {
    preparar: (req) => {
      const parsed = crearAgenteSchema.safeParse(req.body);
      if (!parsed.success) return rechazo(400, { error: parsed.error.flatten() });
      return {
        ok: true,
        payload: { ...parsed.data },
        resumen: `Crear el agente «${parsed.data.name}» (${parsed.data.sector})`,
      };
    },
    ejecutar: async (ctx) => {
      await crearAgenteHandler(requestDeEjecucion(ctx), ctx.res);
    },
  },

  /* ---------- Contactos ---------- */
  agencia_crear_contacto: {
    preparar: (req) => {
      const parsed = createContactSchema.safeParse(req.body);
      if (!parsed.success) return rechazo(400, { error: parsed.error.flatten() });
      return {
        ok: true,
        payload: { ...parsed.data },
        resumen: `Crear el contacto «${parsed.data.name}»`,
      };
    },
    ejecutar: async (ctx) => {
      await operatorCrearContactoHandler(requestDeEjecucion(ctx), ctx.res);
    },
  },
  agencia_editar_contacto: {
    preparar: (req) => {
      const parsed = updateContactSchema.safeParse(req.body);
      if (!parsed.success) return rechazo(400, { error: parsed.error.flatten() });
      const campos = Object.keys(parsed.data).join(", ");
      return {
        ok: true,
        payload: { ...parsed.data },
        resumen: `Editar el contacto ${idDe(req)}${campos ? ` (${campos})` : ""}`,
      };
    },
    ejecutar: async (ctx) => {
      await operatorEditarContactoHandler(requestDeEjecucion(ctx), ctx.res);
    },
  },
  agencia_borrar_contacto: {
    preparar: (req) => ({
      ok: true,
      payload: {},
      resumen: `Borrar el contacto ${idDe(req)}`,
    }),
    ejecutar: async (ctx) => {
      await operatorBorrarContactoHandler(requestDeEjecucion(ctx), ctx.res);
    },
  },
  agencia_convertir_contacto: {
    preparar: (req) => {
      const parsed = convertirContactoSchema.safeParse(req.body);
      if (!parsed.success) return rechazo(400, { error: parsed.error.flatten() });
      return {
        ok: true,
        payload: { ...parsed.data },
        resumen: `Convertir el contacto ${idDe(req)} en cliente`,
      };
    },
    ejecutar: async (ctx) => {
      await convertirContactoHandler(requestDeEjecucion(ctx), ctx.res);
    },
  },

  /* ---------- Agenda (antes sin ningún gate) ---------- */
  agencia_crear_cita: {
    preparar: (req) => {
      const validacion = validarCitaNueva(req.body);
      if (!validacion.ok) return rechazo(400, { error: validacion.mensaje });
      const { fecha, hora, cliente, servicio } = validacion.cita;
      return {
        ok: true,
        payload: { ...validacion.cita },
        resumen: `Crear la cita de ${cliente} el ${fecha} a las ${hora}${servicio ? ` (${servicio})` : ""}`,
      };
    },
    ejecutar: async (ctx) => {
      await agendaCrearHandler(requestDeEjecucion(ctx), ctx.res);
    },
  },
  agencia_editar_cita: {
    preparar: async (req) => {
      const validacion = validarCitaEdicion(req.body);
      if (!validacion.ok) return rechazo(400, { error: validacion.mensaje });
      const id = idDe(req);
      // No se molesta al humano con una cita que no existe.
      const existing = await prisma.platformAppointment.findUnique({ where: { id } });
      if (!existing) return rechazo(404, { error: "Cita no encontrada" });
      const { fecha, hora } = agendaSlices(existing.startAt);
      return {
        ok: true,
        payload: sinFlagsDeConfirmacion(req.body),
        resumen: `Editar la cita de ${existing.client} del ${fecha} a las ${hora}`,
      };
    },
    ejecutar: async (ctx) => {
      await agendaEditarHandler(requestDeEjecucion(ctx), ctx.res);
    },
  },
  agencia_borrar_cita: {
    preparar: async (req) => {
      const id = idDe(req);
      const existing = await prisma.platformAppointment.findUnique({ where: { id } });
      if (!existing) return rechazo(404, { error: "Cita no encontrada" });
      const { fecha, hora } = agendaSlices(existing.startAt);
      return {
        ok: true,
        payload: {},
        resumen: `Borrar la cita de ${existing.client} del ${fecha} a las ${hora}`,
      };
    },
    ejecutar: async (ctx) => {
      await agendaBorrarHandler(requestDeEjecucion(ctx), ctx.res);
    },
  },
};

/** Handler de petición de una escritura (dos argumentos: deja libre el `next`). */
type ManejadorSolicitud = (req: Request, res: Response) => Promise<void>;

/**
 * Handler de petición de una escritura: valida, registra la acción pendiente,
 * hace que el BACKEND avise al humano por Telegram y responde 202 SIN el token.
 * NO ejecuta nada. Los rechazos (400/404/429/503) dejan su fila de auditoría
 * cuando son fallos de la petición, no de validación.
 */
function solicitudDeEscritura(accion: string): ManejadorSolicitud {
  return async (req, res) => {
    const origen = auditOrigin(req);
    const definicion = ACCIONES_ESCRITURA[accion];
    if (!definicion) {
      res.status(404).json({ error: "Acción desconocida" });
      return;
    }

    const preparacion = await definicion.preparar(req);
    if (!preparacion.ok) {
      res.status(preparacion.status).json(preparacion.body);
      return;
    }

    const registro = await registrarPendiente({
      accion,
      payload: preparacion.payload,
      params: { ...((req.params ?? {}) as Record<string, string>) },
      resumen: preparacion.resumen,
      origen,
    });

    if (!registro.ok) {
      writeOperatorAudit({
        accion,
        payload: { resumen: preparacion.resumen },
        origen,
        resultado: "error",
        detalle: registro.detalle,
      });
      res.status(registro.status).json({ error: { code: registro.code, message: registro.mensaje } });
      return;
    }

    res.status(202).json({
      pendiente: true,
      accion,
      resumen: registro.pendiente.resumen,
      expiraEn: new Date(registro.pendiente.expiraEn).toISOString(),
    });
  };
}

/** Definición de una escritura por nombre de acción (la usa el router de confirmaciones). */
export function accionDeEscritura(nombre: string): AccionEscritura | undefined {
  return ACCIONES_ESCRITURA[nombre];
}

/* Handlers de petición: los que monta el router (202, nunca 409). */
export const solicitarCrearCliente = solicitudDeEscritura("agencia_crear_cliente");
export const solicitarConvertirLead = solicitudDeEscritura("agencia_convertir_lead");
export const solicitarCrearAgente = solicitudDeEscritura("agencia_crear_agente");
export const solicitarEditarCliente = solicitudDeEscritura("agencia_editar_cliente");
export const solicitarBorrarCliente = solicitudDeEscritura("agencia_borrar_cliente");
export const solicitarCrearContacto = solicitudDeEscritura("agencia_crear_contacto");
export const solicitarEditarContacto = solicitudDeEscritura("agencia_editar_contacto");
export const solicitarBorrarContacto = solicitudDeEscritura("agencia_borrar_contacto");
export const solicitarConvertirContacto = solicitudDeEscritura("agencia_convertir_contacto");
export const solicitarCrearCita = solicitudDeEscritura("agencia_crear_cita");
export const solicitarEditarCita = solicitudDeEscritura("agencia_editar_cita");
export const solicitarBorrarCita = solicitudDeEscritura("agencia_borrar_cita");

/* ---------- Rutas ---------- */

// Lecturas: sin cambios.
serviceOperatorRouter.get("/estado", estadoHandler);
serviceOperatorRouter.get("/agenda", agendaListarHandler);
serviceOperatorRouter.get("/agenda/huecos", agendaHuecosHandler);
serviceOperatorRouter.get("/clientes", listClientesHandler);
serviceOperatorRouter.get("/clientes/:id", getClienteHandler);
serviceOperatorRouter.get("/contactos", operatorListContactosHandler);

// Escrituras: NUNCA ejecutan en la primera llamada; piden confirmación humana.
serviceOperatorRouter.post("/agenda", solicitarCrearCita);
serviceOperatorRouter.patch("/agenda/:id", solicitarEditarCita);
serviceOperatorRouter.delete("/agenda/:id", solicitarBorrarCita);
serviceOperatorRouter.post("/clientes", solicitarCrearCliente);
serviceOperatorRouter.patch("/clientes/:id", solicitarEditarCliente);
serviceOperatorRouter.delete("/clientes/:id", solicitarBorrarCliente);
serviceOperatorRouter.post("/leads/:id/convertir", solicitarConvertirLead);
serviceOperatorRouter.post("/agentes", solicitarCrearAgente);
serviceOperatorRouter.post("/contactos", solicitarCrearContacto);
serviceOperatorRouter.post("/contactos/:id/convertir", solicitarConvertirContacto);
serviceOperatorRouter.patch("/contactos/:id", solicitarEditarContacto);
serviceOperatorRouter.delete("/contactos/:id", solicitarBorrarContacto);
