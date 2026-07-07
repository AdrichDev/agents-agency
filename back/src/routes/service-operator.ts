import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { nextClientCode, withCodeRetry } from "@/lib/codes";
import { convertSourceToTenant, AlreadyConvertedError } from "@/lib/convert-to-tenant";
import { createAgent } from "@/lib/agent/service";
import { requireOperatorToken } from "@/lib/operator-token";
import { writeOperatorAudit } from "@/lib/operator-audit";
import {
  listContactsHandler,
  createContactHandler,
  updateContactHandler,
  deleteContactHandler,
} from "@/routes/contacts";

// ---------------------------------------------------------------------------
// Router del Operator Agent (F1 aa-operator-agent). Manos server-side de la
// plataforma agents-agency: estado, alta de cliente (tenant), conversión de
// lead → cliente y alta de agente. Protegido SOLO por el service token
// (x-service-token); montado FUERA de /api → no pasa por el gate de usuario.
//
// Protocolo de confirmación: toda escritura exige `confirmado: true` en el
// body, validado aquí en el servidor (no solo en el prompt del LLM). Sin ello
// → 409 confirmation_required y NO se ejecuta nada. Cada POST, tanto en éxito
// como en fallo, deja una fila de auditoría (fire-and-forget).
// ---------------------------------------------------------------------------

export const serviceOperatorRouter = Router();

// Todo el router exige el service token del operador.
serviceOperatorRouter.use(requireOperatorToken());

/** Origen de la orden para la auditoría (cabecera opcional; por defecto service-operator). */
function auditOrigin(req: Request): string {
  return req.header("x-operator-origin") ?? "service-operator";
}

/** true si el body confirma la escritura (`confirmado: true` exacto). */
function isConfirmed(body: unknown): boolean {
  return (body as { confirmado?: unknown } | null)?.confirmado === true;
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
  if (!isConfirmed(req.body)) {
    writeOperatorAudit({
      accion: "agencia_crear_cliente",
      payload: { nombre: (req.body as { nombre?: unknown } | null)?.nombre },
      origen,
      resultado: "error",
      detalle: "confirmation_required",
    });
    return res.status(409).json({ error: { code: "confirmation_required" } });
  }

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

  if (!isConfirmed(req.body)) {
    writeOperatorAudit({
      accion: "agencia_convertir_lead",
      payload: { leadId },
      origen,
      resultado: "error",
      detalle: "confirmation_required",
    });
    return res.status(409).json({ error: { code: "confirmation_required" } });
  }

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
  if (!isConfirmed(req.body)) {
    writeOperatorAudit({
      accion: "agencia_crear_agente",
      payload: { name: (req.body as { name?: unknown } | null)?.name },
      origen,
      resultado: "error",
      detalle: "confirmation_required",
    });
    return res.status(409).json({ error: { code: "confirmation_required" } });
  }

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

/** GET /clientes — lista clientes activos (proyección no sensible + saldo). */
export async function listClientesHandler(_req: Request, res: Response) {
  try {
    const clientes = await prisma.tenant.findMany({
      where: { isActive: true },
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

/** PATCH /clientes/:id — edita un subconjunto de campos (confirmado). */
export async function editarClienteHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  const id = req.params.id;
  if (!isConfirmed(req.body)) {
    writeOperatorAudit({
      accion: "agencia_editar_cliente",
      payload: { id },
      origen,
      resultado: "error",
      detalle: "confirmation_required",
    });
    return res.status(409).json({ error: { code: "confirmation_required" } });
  }

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

/** DELETE /clientes/:id — baja lógica (isActive=false), confirmado. */
export async function borrarClienteHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  const id = req.params.id;
  if (!isConfirmed(req.body)) {
    writeOperatorAudit({
      accion: "agencia_borrar_cliente",
      payload: { id },
      origen,
      resultado: "error",
      detalle: "confirmation_required",
    });
    return res.status(409).json({ error: { code: "confirmation_required" } });
  }

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

/** GET /contactos — lista contactos (reuso de contacts.listContactsHandler, solo lectura). */
export async function operatorListContactosHandler(req: Request, res: Response) {
  return listContactsHandler(req, res);
}

/** POST /contactos — crea un contacto (confirmado; reuso de createContactHandler). */
export async function operatorCrearContactoHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  if (!isConfirmed(req.body)) {
    writeOperatorAudit({
      accion: "agencia_crear_contacto",
      payload: { name: (req.body as { name?: unknown } | null)?.name },
      origen,
      resultado: "error",
      detalle: "confirmation_required",
    });
    return res.status(409).json({ error: { code: "confirmation_required" } });
  }
  return delegateWithAudit(
    req,
    res,
    "agencia_crear_contacto",
    { name: (req.body as { name?: unknown } | null)?.name },
    origen,
    createContactHandler
  );
}

/** PATCH /contactos/:id — edita un contacto (confirmado; reuso de updateContactHandler). */
export async function operatorEditarContactoHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  if (!isConfirmed(req.body)) {
    writeOperatorAudit({
      accion: "agencia_editar_contacto",
      payload: { id: req.params.id },
      origen,
      resultado: "error",
      detalle: "confirmation_required",
    });
    return res.status(409).json({ error: { code: "confirmation_required" } });
  }
  return delegateWithAudit(
    req,
    res,
    "agencia_editar_contacto",
    { id: req.params.id },
    origen,
    updateContactHandler
  );
}

/** DELETE /contactos/:id — baja lógica del contacto (confirmado; reuso de deleteContactHandler). */
export async function operatorBorrarContactoHandler(req: Request, res: Response) {
  const origen = auditOrigin(req);
  if (!isConfirmed(req.body)) {
    writeOperatorAudit({
      accion: "agencia_borrar_contacto",
      payload: { id: req.params.id },
      origen,
      resultado: "error",
      detalle: "confirmation_required",
    });
    return res.status(409).json({ error: { code: "confirmation_required" } });
  }
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

  if (!isConfirmed(req.body)) {
    writeOperatorAudit({
      accion: "agencia_convertir_contacto",
      payload: { contactId: id },
      origen,
      resultado: "error",
      detalle: "confirmation_required",
    });
    return res.status(409).json({ error: { code: "confirmation_required" } });
  }

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

/** Citas no canceladas de la agenda de plataforma dentro de un rango. */
async function fetchAgendaAppointments(desde: Date, hasta: Date) {
  return prisma.platformAppointment.findMany({
    where: { startAt: { gte: desde, lte: hasta }, status: { not: "Cancelada" } },
    orderBy: { startAt: "asc" },
  });
}

/**
 * GET /agenda?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — lista las citas de la agenda
 * del owner (PlatformAppointment, espejo de Google Calendar) en el rango dado.
 * Solo lectura → sin auditoría. Fuente reutilizable para el bot de cada tenant.
 */
export async function agendaListarHandler(req: Request, res: Response) {
  const range = resolveAgendaRange(req.query as Record<string, unknown>);
  if (!range) return res.status(400).json({ error: "desde/hasta deben ser fechas YYYY-MM-DD válidas (hasta >= desde)" });
  try {
    const rows = await fetchAgendaAppointments(range.desde, range.hasta);
    res.json({
      desde: range.desdeStr,
      hasta: range.hastaStr,
      total: rows.length,
      citas: rows.map((a) => ({
        id: a.id,
        ...agendaSlices(a.startAt),
        cliente: a.client,
        servicio: a.service ?? "",
        estado: a.status,
      })),
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

/* ---------- Rutas ---------- */

serviceOperatorRouter.get("/estado", estadoHandler);
serviceOperatorRouter.get("/agenda", agendaListarHandler);
serviceOperatorRouter.get("/agenda/huecos", agendaHuecosHandler);
serviceOperatorRouter.post("/clientes", crearClienteHandler);
serviceOperatorRouter.get("/clientes", listClientesHandler);
serviceOperatorRouter.get("/clientes/:id", getClienteHandler);
serviceOperatorRouter.patch("/clientes/:id", editarClienteHandler);
serviceOperatorRouter.delete("/clientes/:id", borrarClienteHandler);
serviceOperatorRouter.post("/leads/:id/convertir", convertirLeadHandler);
serviceOperatorRouter.post("/agentes", crearAgenteHandler);
serviceOperatorRouter.get("/contactos", operatorListContactosHandler);
serviceOperatorRouter.post("/contactos", operatorCrearContactoHandler);
serviceOperatorRouter.post("/contactos/:id/convertir", convertirContactoHandler);
serviceOperatorRouter.patch("/contactos/:id", operatorEditarContactoHandler);
serviceOperatorRouter.delete("/contactos/:id", operatorBorrarContactoHandler);
