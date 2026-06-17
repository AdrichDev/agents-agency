import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type {
  GranularityKey,
  StatsQuery,
  StatsResponse,
  Totals,
  MonthlyPoint,
  BillingMonthPoint,
  Billing,
  TopAgent,
  RawMonthCount,
  RawBillingRow,
  RawTopAgent,
} from "@/lib/stats/types";
import { GRANULARITY_MAP } from "@/lib/stats/types";
import {
  periodKey,
  enumeratePeriods,
  twelveMonthsAgo,
  rangeStart,
  rangeEnd,
  toYYYYMM,
  toCountMap,
  buildTotals,
  accumulateBilling,
  mapTopAgents,
} from "@/lib/stats/helpers";

// ── Main aggregator ────────────────────────────────────────────────────────

export async function getStats(query?: StatsQuery): Promise<StatsResponse> {
  // No-params path → byte-identical to P7
  if (!query || Object.keys(query).length === 0) {
    return getStatsP7();
  }

  const g: GranularityKey = query.granularity ?? "month";
  // WHITELIST: map enum key to literal string for date_trunc — NEVER interpolate user input
  const dtUnit = GRANULARITY_MAP[g];

  const since = rangeStart(query);
  const until = rangeEnd(query);

  // ── Totals (always global counts) ─────────────────────────────────────
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
    prisma.client.count(),
    prisma.skill.count(),
    prisma.skill.groupBy({ by: ["type"], _count: { _all: true } }),
    prisma.lead.count(),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.conversation.count(),
    prisma.message.count(),
    prisma.automation.count(),
    prisma.budget.count(),
  ]);

  const totals: Totals = buildTotals({
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

  // ── Build filter fragments ───────────────────────────────────────────
  const clientFilter: Prisma.Sql = query.clientId
    ? Prisma.sql`AND b."clientId" = ${query.clientId}`
    : Prisma.sql``;

  const sectorFilter: Prisma.Sql = query.sector
    ? Prisma.sql`AND c."sector" = ${query.sector}`
    : Prisma.sql``;

  const sectorJoin: Prisma.Sql = query.sector
    ? Prisma.sql`JOIN "Client" c ON b."clientId" = c."id"`
    : Prisma.sql``;

  const statusFilter: Prisma.Sql = query.status
    ? Prisma.sql`AND b."status" = ${query.status}`
    : Prisma.sql``;

  // serviceId via BudgetLine
  const serviceJoin: Prisma.Sql = query.serviceId
    ? Prisma.sql`JOIN "BudgetLine" bl ON bl."budgetId" = b."id" AND bl."serviceId" = ${query.serviceId}`
    : Prisma.sql``;

  // revenueType for billing SUM
  const revenueExpr: Prisma.Sql = (() => {
    const rt = query.revenueType ?? "all";
    if (rt === "impl") return Prisma.sql`SUM(b."totalImpl")::float`;
    if (rt === "maint") return Prisma.sql`SUM(b."totalMaint")::float`;
    return Prisma.sql`SUM(b."totalImpl" + b."totalMaint")::float`;
  })();

  const dateSince = since;
  const dateUntil = until;

  // ── Monthly series (Lead + Budget with optional filters) ────────────
  // Use date_trunc with whitelisted literal unit
  // We use Prisma.raw ONLY for the whitelisted dtUnit constant, not user input
  const dtUnitSql = Prisma.raw(`'${dtUnit}'`);

  const dateFragB: Prisma.Sql = (() => {
    if (dateSince && dateUntil) return Prisma.sql`AND b."createdAt" >= ${dateSince} AND b."createdAt" <= ${dateUntil}`;
    if (dateSince) return Prisma.sql`AND b."createdAt" >= ${dateSince}`;
    if (dateUntil) return Prisma.sql`AND b."createdAt" <= ${dateUntil}`;
    return Prisma.sql``;
  })();

  const dateFragL: Prisma.Sql = (() => {
    if (dateSince && dateUntil) return Prisma.sql`AND l."createdAt" >= ${dateSince} AND l."createdAt" <= ${dateUntil}`;
    if (dateSince) return Prisma.sql`AND l."createdAt" >= ${dateSince}`;
    if (dateUntil) return Prisma.sql`AND l."createdAt" <= ${dateUntil}`;
    return Prisma.sql``;
  })();

  // Lead monthly (only date + agentId filter applicable)
  const agentFilterL: Prisma.Sql = query.agentId
    ? Prisma.sql`AND l."agentId" = ${query.agentId}`
    : Prisma.sql``;

  const rawLeadMonths = await prisma.$queryRaw<RawMonthCount[]>`
    SELECT date_trunc(${dtUnitSql}, l."createdAt" AT TIME ZONE 'UTC') AS month,
           COUNT(*)::bigint AS count
    FROM "Lead" l
    WHERE 1=1 ${dateFragL} ${agentFilterL}
    GROUP BY 1
    ORDER BY 1
  `;

  // Budget monthly with filters
  const rawBudgetMonths = await prisma.$queryRaw<RawMonthCount[]>`
    SELECT date_trunc(${dtUnitSql}, b."createdAt" AT TIME ZONE 'UTC') AS month,
           COUNT(*)::bigint AS count
    FROM "Budget" b
    ${serviceJoin}
    ${sectorJoin}
    WHERE 1=1
    ${dateFragB}
    ${clientFilter}
    ${sectorFilter}
    ${statusFilter}
    GROUP BY 1
    ORDER BY 1
  `;

  // Agent + conversation monthly (no budget filters)
  const dateFragA: Prisma.Sql = (() => {
    if (dateSince && dateUntil) return Prisma.sql`AND "createdAt" >= ${dateSince} AND "createdAt" <= ${dateUntil}`;
    if (dateSince) return Prisma.sql`AND "createdAt" >= ${dateSince}`;
    if (dateUntil) return Prisma.sql`AND "createdAt" <= ${dateUntil}`;
    return Prisma.sql``;
  })();

  const agentFilterC: Prisma.Sql = query.agentId
    ? Prisma.sql`AND "agentId" = ${query.agentId}`
    : Prisma.sql``;

  const [rawAgentMonths, rawConvMonths] = await Promise.all([
    prisma.$queryRaw<RawMonthCount[]>`
      SELECT date_trunc(${dtUnitSql}, "createdAt" AT TIME ZONE 'UTC') AS month,
             COUNT(*)::bigint AS count
      FROM "Agent"
      WHERE 1=1 ${dateFragA}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<RawMonthCount[]>`
      SELECT date_trunc(${dtUnitSql}, "createdAt" AT TIME ZONE 'UTC') AS month,
             COUNT(*)::bigint AS count
      FROM "Conversation"
      WHERE 1=1 ${dateFragA} ${agentFilterC}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  const keyOf = (d: Date) => periodKey(d, g);
  const agentMap = toCountMap(rawAgentMonths, keyOf);
  const leadMap = toCountMap(rawLeadMonths, keyOf);
  const convMap = toCountMap(rawConvMonths, keyOf);
  const budgetMap = toCountMap(rawBudgetMonths, keyOf);

  // Collect all distinct period keys from results
  const allKeys = new Set<string>([
    ...agentMap.keys(), ...leadMap.keys(), ...convMap.keys(), ...budgetMap.keys(),
  ]);

  // Zero-fill the series so charts always get a continuous timeline.
  // Bounds: explicit range when available, otherwise the raw data extent.
  const rawDates: Date[] = [
    ...rawAgentMonths, ...rawLeadMonths, ...rawConvMonths, ...rawBudgetMonths,
  ].map((r) => r.month);
  const fillStart = since ?? (rawDates.length
    ? new Date(Math.min(...rawDates.map((d) => d.getTime())))
    : null);
  const fillEnd = until ?? new Date();

  let periodKeys: string[] = [];
  if (fillStart) periodKeys = enumeratePeriods(fillStart, fillEnd, g);
  if (periodKeys.length === 0) periodKeys = Array.from(allKeys).sort();

  // Never drop data points that fall outside the computed fill window
  const keySet = new Set(periodKeys);
  for (const k of allKeys) if (!keySet.has(k)) periodKeys.push(k);
  periodKeys.sort();

  const monthly: MonthlyPoint[] = periodKeys.map((key) => ({
    month: key,
    agents: agentMap.get(key) ?? 0,
    leads: leadMap.get(key) ?? 0,
    conversations: convMap.get(key) ?? 0,
    budgets: budgetMap.get(key) ?? 0,
  }));

  // ── Billing ──────────────────────────────────────────────────────────
  interface RawBillingFiltered {
    month: Date;
    status: string;
    total: number | null;
  }

  const rawBilling = await prisma.$queryRaw<RawBillingFiltered[]>`
    SELECT date_trunc(${dtUnitSql}, b."createdAt" AT TIME ZONE 'UTC') AS month,
           b."status",
           ${revenueExpr} AS total
    FROM "Budget" b
    ${serviceJoin}
    ${sectorJoin}
    WHERE 1=1
    ${dateFragB}
    ${clientFilter}
    ${sectorFilter}
    ${statusFilter}
    GROUP BY 1, 2
    ORDER BY 1
  `;

  const { monthMap: billingMonthMap, totals: billingTotals } = accumulateBilling(
    rawBilling,
    keyOf
  );

  // Align billing to the same continuous timeline as the activity series
  const billingKeys = new Set<string>([...periodKeys, ...billingMonthMap.keys()]);
  const billingMonthly: BillingMonthPoint[] = Array.from(billingKeys).sort().map(
    (key) =>
      billingMonthMap.get(key) ?? { month: key, total: 0, draft: 0, sent: 0, accepted: 0, rejected: 0 }
  );

  const billing: Billing = { monthly: billingMonthly, totals: billingTotals };

  // ── Top agents ────────────────────────────────────────────────────────
  const rawTopAgents = await prisma.$queryRaw<RawTopAgent[]>`
    SELECT "agentId", COUNT(*)::bigint AS count
    FROM "Conversation"
    GROUP BY "agentId"
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
  const topAgents: TopAgent[] = mapTopAgents(rawTopAgents, nameMap);

  return { totals, monthly, billing, topAgents };
}

// ── P7 no-params path (byte-identical to original) ────────────────────────

async function getStatsP7(): Promise<StatsResponse> {
  const since = twelveMonthsAgo();

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
    prisma.client.count(),
    prisma.skill.count(),
    prisma.skill.groupBy({ by: ["type"], _count: { _all: true } }),
    prisma.lead.count(),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.conversation.count(),
    prisma.message.count(),
    prisma.automation.count(),
    prisma.budget.count(),
  ]);

  const totals: Totals = buildTotals({
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

  const [rawAgentMonths, rawLeadMonths, rawConvMonths, rawBudgetMonths] =
    await Promise.all([
      prisma.$queryRaw<RawMonthCount[]>`
        SELECT date_trunc('month', "createdAt" AT TIME ZONE 'UTC') AS month,
               COUNT(*)::bigint AS count
        FROM "Agent"
        WHERE "createdAt" >= ${since}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.$queryRaw<RawMonthCount[]>`
        SELECT date_trunc('month', "createdAt" AT TIME ZONE 'UTC') AS month,
               COUNT(*)::bigint AS count
        FROM "Lead"
        WHERE "createdAt" >= ${since}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.$queryRaw<RawMonthCount[]>`
        SELECT date_trunc('month', "createdAt" AT TIME ZONE 'UTC') AS month,
               COUNT(*)::bigint AS count
        FROM "Conversation"
        WHERE "createdAt" >= ${since}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.$queryRaw<RawMonthCount[]>`
        SELECT date_trunc('month', "createdAt" AT TIME ZONE 'UTC') AS month,
               COUNT(*)::bigint AS count
        FROM "Budget"
        WHERE "createdAt" >= ${since}
        GROUP BY 1
        ORDER BY 1
      `,
    ]);

  const agentMap = toCountMap(rawAgentMonths, toYYYYMM);
  const leadMap = toCountMap(rawLeadMonths, toYYYYMM);
  const convMap = toCountMap(rawConvMonths, toYYYYMM);
  const budgetMap = toCountMap(rawBudgetMonths, toYYYYMM);

  const monthly: MonthlyPoint[] = [];
  const start = twelveMonthsAgo();
  for (let i = 0; i < 12; i++) {
    const d = new Date(start);
    d.setUTCMonth(d.getUTCMonth() + i);
    const key = toYYYYMM(d);
    monthly.push({
      month: key,
      agents: agentMap.get(key) ?? 0,
      leads: leadMap.get(key) ?? 0,
      conversations: convMap.get(key) ?? 0,
      budgets: budgetMap.get(key) ?? 0,
    });
  }

  const rawBilling = await prisma.$queryRaw<RawBillingRow[]>`
    SELECT
      date_trunc('month', "createdAt" AT TIME ZONE 'UTC') AS month,
      status,
      SUM("totalImpl" + "totalMaint")::float AS total
    FROM "Budget"
    WHERE "createdAt" >= ${since}
    GROUP BY 1, 2
    ORDER BY 1
  `;

  const { monthMap: billingMonthMap, totals: billingTotals } = accumulateBilling(
    rawBilling,
    toYYYYMM
  );

  const billingMonthly: BillingMonthPoint[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(start);
    d.setUTCMonth(d.getUTCMonth() + i);
    const key = toYYYYMM(d);
    billingMonthly.push(
      billingMonthMap.get(key) ?? { month: key, total: 0, draft: 0, sent: 0, accepted: 0, rejected: 0 }
    );
  }

  const billing: Billing = { monthly: billingMonthly, totals: billingTotals };

  const rawTopAgents = await prisma.$queryRaw<RawTopAgent[]>`
    SELECT "agentId", COUNT(*)::bigint AS count
    FROM "Conversation"
    GROUP BY "agentId"
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
  const topAgents: TopAgent[] = mapTopAgents(rawTopAgents, nameMap);

  return { totals, monthly, billing, topAgents };
}
