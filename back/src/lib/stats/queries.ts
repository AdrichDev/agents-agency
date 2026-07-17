// Repository de stats: encapsula las queries crudas repetidas entre el path
// filtrado (getStats) y el path P7 (sin params). Construye SQL con Prisma.sql
// componiendo fragmentos — NUNCA interpola input de usuario sin parametrizar.
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { RawMonthCount, RawTopAgent, Totals, TopAgent } from "@/lib/stats/types";
import { buildTotals, mapTopAgents } from "@/lib/stats/helpers";

// ── Totales globales (idéntico en ambos paths) ───────────────────────────────
export async function fetchTotals(): Promise<Totals> {
  const [
    agentsCount,
    clientsCount,
    skillsCount,
    skillsByTypeRaw,
    leadsCount,
    leadsByStatusRaw,
    conversationsCount,
    messagesCount,
    automationsCount,
    budgetsCount,
  ] = await Promise.all([
    prisma.agent.count(),
    prisma.tenant.count(),
    prisma.skill.count(),
    prisma.skill.groupBy({ by: ["type"], _count: { _all: true } }),
    prisma.lead.count(),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    // F1 (aa-agente-consola-pruebas, T1.3): la analítica del cliente excluye las
    // conversaciones de la consola de pruebas del operador (isTest=true).
    prisma.conversation.count({ where: { isTest: false } }),
    prisma.message.count(),
    prisma.automation.count(),
    prisma.budget.count(),
  ]);

  return buildTotals({
    agents: agentsCount,
    clients: clientsCount,
    skills: skillsCount,
    skillsByType: skillsByTypeRaw,
    leads: leadsCount,
    leadsByStatus: leadsByStatusRaw,
    conversations: conversationsCount,
    messages: messagesCount,
    automations: automationsCount,
    budgets: budgetsCount,
  });
}

// ── Serie mensual: COUNT por periodo (date_trunc) ────────────────────────────
export interface MonthlyCountOpts {
  /** Tabla con alias opcional, p.ej. Prisma.sql`"aa"."presupuesto" b`. */
  from: Prisma.Sql;
  /** Columna timestamp, p.ej. Prisma.sql`b."creado_en"` o Prisma.sql`"creado_en"`. */
  tsCol: Prisma.Sql;
  /** Unidad de date_trunc YA whitelisteada (Prisma.raw), p.ej. Prisma.raw("'month'"). */
  unit: Prisma.Sql;
  /** JOINs opcionales. */
  joins?: Prisma.Sql;
  /** Cláusula WHERE completa (sin la palabra WHERE), p.ej. Prisma.sql`1=1 ${frag}`. */
  where: Prisma.Sql;
}

export function monthlyCount(opts: MonthlyCountOpts): Promise<RawMonthCount[]> {
  const joins = opts.joins ?? Prisma.sql``;
  return prisma.$queryRaw<RawMonthCount[]>`
    SELECT date_trunc(${opts.unit}, ${opts.tsCol} AT TIME ZONE 'UTC') AS month,
           COUNT(*)::bigint AS count
    FROM ${opts.from}
    ${joins}
    WHERE ${opts.where}
    GROUP BY 1
    ORDER BY 1
  `;
}

// ── Billing: SUM de ingresos por periodo y estado ────────────────────────────
export interface BillingQueryOpts {
  unit: Prisma.Sql;
  /** Expresión SUM(...)::float ya construida (whitelisteada por revenueType). */
  revenueExpr: Prisma.Sql;
  /** Tabla con alias b, p.ej. Prisma.sql`"aa"."presupuesto" b`. */
  from: Prisma.Sql;
  joins?: Prisma.Sql;
  where: Prisma.Sql;
}

export function billingQuery<T>(opts: BillingQueryOpts): Promise<T[]> {
  const joins = opts.joins ?? Prisma.sql``;
  return prisma.$queryRaw<T[]>`
    SELECT date_trunc(${opts.unit}, b."creado_en" AT TIME ZONE 'UTC') AS month,
           b."estado" AS status,
           ${opts.revenueExpr} AS total
    FROM ${opts.from}
    ${joins}
    WHERE ${opts.where}
    GROUP BY 1, 2
    ORDER BY 1
  `;
}

// ── Top agentes por nº de conversaciones (idéntico en ambos paths) ───────────
export async function fetchTopAgents(): Promise<TopAgent[]> {
  const rawTopAgents = await prisma.$queryRaw<RawTopAgent[]>`
    SELECT "agente_id" AS "agentId", COUNT(*)::bigint AS count
    FROM "aa"."conversacion"
    WHERE "es_prueba" = false
    GROUP BY "agente_id"
    ORDER BY count DESC
    LIMIT 5
  `;

  const agentIds = rawTopAgents.map((r) => r.agentId);
  const agentNames = agentIds.length
    ? await prisma.agent.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, name: true },
      })
    : [];

  const nameMap = new Map<string, string>(agentNames.map((a) => [a.id, a.name]));
  return mapTopAgents(rawTopAgents, nameMap);
}
