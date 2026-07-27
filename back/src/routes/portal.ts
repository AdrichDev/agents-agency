/**
 * H5 (aa-portal-cliente, T3) — Portal del cliente. SÓLO LECTURA.
 *
 * Regla que gobierna todo el fichero: **el tenant sale siempre de `req.user.tenantId`**, nunca de la
 * petición. Ninguna firma de aquí acepta un tenant por query, body o path. Si lo aceptara, el
 * aislamiento entre clientes lo decidiría el cliente, y un `?tenantId=` de otro sería suficiente.
 *
 * La puerta `clientScopeGate` ya garantiza que un `client` sin tenant no llega hasta aquí, pero estos
 * handlers vuelven a comprobarlo: son alcanzables también por staff, y un router que da por supuesto
 * lo que otro middleware validó se rompe en silencio el día que alguien lo monta en otro sitio.
 *
 * Recurso de otro tenant ⇒ **404, no 403** (T3.5). Un 403 confirma que ese ID existe; el 404 no
 * distingue entre "no existe" y "no es tuyo", que es justo lo que un cliente no debe poder averiguar.
 */
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { asyncHandler, validate, HttpError } from "@/lib/http";
import {
  countBillableAgents,
  quotaWarningLevel,
  resolveTokenQuota,
  sumAgentPeriodUsage,
} from "@/lib/quota";
import { BILLABLE_STATUSES } from "@/lib/agent/lifecycle";
import type { Request } from "express";

export const portalRouter = Router();

/**
 * Estados que el cliente ve. `draft` y `archived` quedan fuera a propósito: son estados del taller del
 * estudio, no del producto contratado, y enseñar un borrador como si fuera suyo genera la pregunta
 * "¿por qué no responde?" sobre algo que nunca se publicó.
 *
 * Coincide con `BILLABLE_STATUSES` de H3 y eso no es casualidad: lo que se cobra es lo que se ve.
 */
const VISIBLE_STATUSES = BILLABLE_STATUSES;

/**
 * Tenant de la sesión, o 403.
 *
 * No acepta ningún parámetro de la petición. La única forma de cambiar de tenant es iniciar sesión con
 * otro usuario.
 */
function tenantOf(req: Request): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) throw new HttpError(403, "Usuario sin tenant asignado");
  return tenantId;
}

/**
 * GET /api/portal/me — Lo que el cliente ha contratado y lo que lleva gastado.
 *
 * El cupo NO se recalcula aquí: se resuelve con `resolveTokenQuota`, la misma función que usa el gate
 * de metering para cortar. Si el portal tuviera su propia cuenta, habría un consumo exacto en el que el
 * agente está cortado y el portal dice que queda saldo — y quien lo descubriría sería el cliente.
 *
 * Sin importes. El precio vive en Stripe (H6) y en el catálogo del front; aquí sólo viaja el `codigo`
 * del plan, con el que el front cruza su tarifa.
 */
portalRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        isActive: true,
        credentialMode: true,
        tokenBalance: true,
        tokensUsedPeriod: true,
        periodStart: true,
        periodAnchorDay: true,
        plan: { select: { codigo: true, nombre: true, tokenQuotaPerAgent: true } },
      },
    });
    // Sesión válida cuyo tenant ya no existe. Improbable, pero 500 sería mentira: el servidor está
    // bien, es la fila la que se fue.
    if (!tenant) throw new HttpError(404, "Cliente no encontrado");

    const billableAgents = await countBillableAgents(tenantId);
    const { limit, source } = resolveTokenQuota(tenant, billableAgents);
    const byok = tenant.credentialMode === "byok";

    res.json({
      tenant: { id: tenant.id, name: tenant.name, isActive: tenant.isActive },
      plan: tenant.plan ? { codigo: tenant.plan.codigo, nombre: tenant.plan.nombre } : null,
      period: { start: tenant.periodStart, anchorDay: tenant.periodAnchorDay },
      usage: {
        // Consumo DEL PERIODO, no el acumulado de por vida: es el contador contra el que corta el gate.
        tokensUsedPeriod: tenant.tokensUsedPeriod,
        // `null` = sin tope, no cero.
        tokenQuota: limit,
        quotaSource: source,
        remaining: limit === null ? null : Math.max(0, limit - tenant.tokensUsedPeriod),
        // En byok no hay aviso: el cupo no se aplica, así que un porcentaje sería un número inventado.
        warning: byok ? null : quotaWarningLevel(tenant.tokensUsedPeriod, limit),
      },
      credentialMode: tenant.credentialMode,
      billableAgents,
    });
  })
);

/**
 * GET /api/portal/agents — Sus agentes vivos, con lo que ha gastado cada uno.
 *
 * El consumo por agente se saca de `sumAgentPeriodUsage` (H4 T5), el mismo agregado del log de uso que
 * mira el tope por agente. Sin secretos del agente: ni `systemPrompt`, ni `publicKey`, ni modelo. El
 * cliente contrató un asistente que funciona, no la receta con la que está hecho.
 */
portalRouter.get(
  "/agents",
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { periodStart: true },
    });
    if (!tenant) throw new HttpError(404, "Cliente no encontrado");

    const agents = await prisma.agent.findMany({
      where: { tenantId, status: { in: [...VISIBLE_STATUSES] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        sector: true,
        status: true,
        statusChangedAt: true,
        channel: true,
        createdAt: true,
      },
    });

    const conConsumo = await Promise.all(
      agents.map(async (a) => ({
        ...a,
        tokensUsedPeriod: await sumAgentPeriodUsage(a.id, tenant.periodStart),
      }))
    );

    res.json(conConsumo);
  })
);

const pageSchema = z.object({
  // Límite acotado: sin techo, un `?limit=100000` convierte un endpoint de lectura en una descarga
  // masiva de conversaciones.
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).optional(),
});

/**
 * Agente del tenant de la sesión, o 404.
 *
 * El filtro por tenant va en el `where`, no en un `if` posterior: así no existe la versión de este
 * código que lee la fila primero y decide después.
 */
async function agentOfTenant(agentId: string, tenantId: string) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, tenantId, status: { in: [...VISIBLE_STATUSES] } },
    select: { id: true, name: true },
  });
  if (!agent) throw new HttpError(404, "Agente no encontrado");
  return agent;
}

/**
 * GET /api/portal/agents/:id/conversations — Conversaciones reales del agente.
 *
 * `isTest = false` fuera de discusión: las conversaciones de la consola de pruebas son del estudio
 * probando, y enseñárselas al cliente como tráfico suyo falsea la única métrica que le importa.
 *
 * Paginación por cursor sobre el `id` con orden por `createdAt` descendente.
 */
portalRouter.get(
  "/agents/:id/conversations",
  validate.query(pageSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req);
    const { limit, cursor } = req.validatedQuery as z.infer<typeof pageSchema>;

    await agentOfTenant(req.params.id, tenantId);

    const rows = await prisma.conversation.findMany({
      where: { agentId: req.params.id, isTest: false },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        channel: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
    });

    const hayMas = rows.length > limit;
    const items = hayMas ? rows.slice(0, limit) : rows;

    res.json({
      items: items.map((c) => ({
        id: c.id,
        channel: c.channel,
        createdAt: c.createdAt,
        messageCount: c._count.messages,
      })),
      // `null` cuando no hay más, para que el front no tenga que adivinar por la longitud.
      nextCursor: hayMas ? items[items.length - 1].id : null,
    });
  })
);

/**
 * GET /api/portal/conversations/:id/messages — Mensajes de una conversación suya.
 *
 * `Conversation` no tiene `tenantId`, así que el escopado va por join a `Agent`. Ese join es la única
 * cosa que impide leer la conversación de otro cliente conociendo su ID, y por eso está en el `where`
 * de la propia consulta y no en una comprobación aparte.
 *
 * `toolCalls` no viaja: son las llamadas internas del agente (qué herramienta, con qué argumentos), o
 * sea la mecánica del producto, no la conversación que el cliente quiere leer.
 */
portalRouter.get(
  "/conversations/:id/messages",
  validate.query(pageSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req);
    const { limit, cursor } = req.validatedQuery as z.infer<typeof pageSchema>;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        isTest: false,
        agent: { tenantId, status: { in: [...VISIBLE_STATUSES] } },
      },
      select: { id: true, channel: true, createdAt: true, agentId: true },
    });
    if (!conversation) throw new HttpError(404, "Conversación no encontrada");

    const rows = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, role: true, content: true, createdAt: true },
    });

    const hayMas = rows.length > limit;
    const items = hayMas ? rows.slice(0, limit) : rows;

    res.json({
      conversation: {
        id: conversation.id,
        channel: conversation.channel,
        createdAt: conversation.createdAt,
        agentId: conversation.agentId,
      },
      items,
      nextCursor: hayMas ? items[items.length - 1].id : null,
    });
  })
);
