import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type {
  GranularityKey,
  StatsQuery,
  StatsResponse,
  SkillTypeCount,
  Totals,
  MonthlyPoint,
  BillingMonthPoint,
  BillingTotals,
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
  round2,
  toYYYYMM,
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

  const skillsByType: SkillTypeCount[] = skillsByTypeRaw.map((r) => ({
    type: r.type,
    count: r._count._all,
  }));

  const leadsByStatus: Record<string, number> = {};
  for (const r of leadsByStatusRaw) {
    leadsByStatus[r.status] = r._count._all;
  }

  const totals: Totals = {
    agents: agentsCount,
    clients: clientsCount,
    skills: skillsCount,
    skillsByType,
    leads: leadsCount,
    leadsByStatus,
    conversations: conversationsCount,
    messages: messagesCount,
    automations: automationsCount,
    budgets: budgetsCount,
  };

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

  const agentMap = new Map<string, number>();
  for (const r of rawAgentMonths) agentMap.set(periodKey(r.month, g), Number(r.count));

  const leadMap = new Map<string, number>();
  for (const r of rawLeadMonths) leadMap.set(periodKey(r.month, g), Number(r.count));

  const convMap = new Map<string, number>();
  for (const r of rawConvMonths) convMap.set(periodKey(r.month, g), Number(r.count));

  const budgetMap = new Map<string, number>();
  for (const r of rawBudgetMonths) budgetMap.set(periodKey(r.month, g), Number(r.count));

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

  const billingMonthMap = new Map<string, BillingMonthPoint>();
  const billingTotals: BillingTotals = { total: 0, draft: 0, sent: 0, accepted: 0, rejected: 0 };

  for (const r of rawBilling) {
    const key = periodKey(r.month, g);
    if (!billingMonthMap.has(key)) {
      billingMonthMap.set(key, { month: key, total: 0, draft: 0, sent: 0, accepted: 0, rejected: 0 });
    }
    const row = billingMonthMap.get(key)!;
    const amount = round2(Number(r.total ?? 0));
    row.total = round2(row.total + amount);
    if (r.status === "draft") row.draft = round2(row.draft + amount);
    else if (r.status === "sent") row.sent = round2(row.sent + amount);
    else if (r.status === "accepted") row.accepted = round2(row.accepted + amount);
    else if (r.status === "rejected") row.rejected = round2(row.rejected + amount);

    billingTotals.total = round2(billingTotals.total + amount);
    if (r.status === "draft") billingTotals.draft = round2(billingTotals.draft + amount);
    else if (r.status === "sent") billingTotals.sent = round2(billingTotals.sent + amount);
    else if (r.status === "accepted") billingTotals.accepted = round2(billingTotals.accepted + amount);
    else if (r.status === "rejected") billingTotals.rejected = round2(billingTotals.rejected + amount);
  }

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

  const topAgents: TopAgent[] = rawTopAgents.map((r) => ({
    agentId: r.agentId,
    agentName: nameMap.get(r.agentId) ?? r.agentId,
    conversations: Number(r.count),
  }));

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

  const skillsByType: SkillTypeCount[] = skillsByTypeRaw.map((r) => ({
    type: r.type,
    count: r._count._all,
  }));

  const leadsByStatus: Record<string, number> = {};
  for (const r of leadsByStatusRaw) {
    leadsByStatus[r.status] = r._count._all;
  }

  const totals: Totals = {
    agents: agentsCount,
    clients: clientsCount,
    skills: skillsCount,
    skillsByType,
    leads: leadsCount,
    leadsByStatus,
    conversations: conversationsCount,
    messages: messagesCount,
    automations: automationsCount,
    budgets: budgetsCount,
  };

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

  const agentMap = new Map<string, number>();
  for (const r of rawAgentMonths) agentMap.set(toYYYYMM(r.month), Number(r.count));

  const leadMap = new Map<string, number>();
  for (const r of rawLeadMonths) leadMap.set(toYYYYMM(r.month), Number(r.count));

  const convMap = new Map<string, number>();
  for (const r of rawConvMonths) convMap.set(toYYYYMM(r.month), Number(r.count));

  const budgetMap = new Map<string, number>();
  for (const r of rawBudgetMonths) budgetMap.set(toYYYYMM(r.month), Number(r.count));

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

  const billingMonthMap = new Map<string, BillingMonthPoint>();
  const billingTotals: BillingTotals = { total: 0, draft: 0, sent: 0, accepted: 0, rejected: 0 };

  for (const r of rawBilling) {
    const key = toYYYYMM(r.month);
    if (!billingMonthMap.has(key)) {
      billingMonthMap.set(key, { month: key, total: 0, draft: 0, sent: 0, accepted: 0, rejected: 0 });
    }
    const row = billingMonthMap.get(key)!;
    const amount = round2(Number(r.total ?? 0));
    row.total = round2(row.total + amount);
    if (r.status === "draft") row.draft = round2(row.draft + amount);
    else if (r.status === "sent") row.sent = round2(row.sent + amount);
    else if (r.status === "accepted") row.accepted = round2(row.accepted + amount);
    else if (r.status === "rejected") row.rejected = round2(row.rejected + amount);

    billingTotals.total = round2(billingTotals.total + amount);
    if (r.status === "draft") billingTotals.draft = round2(billingTotals.draft + amount);
    else if (r.status === "sent") billingTotals.sent = round2(billingTotals.sent + amount);
    else if (r.status === "accepted") billingTotals.accepted = round2(billingTotals.accepted + amount);
    else if (r.status === "rejected") billingTotals.rejected = round2(billingTotals.rejected + amount);
  }

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

  const topAgents: TopAgent[] = rawTopAgents.map((r) => ({
    agentId: r.agentId,
    agentName: nameMap.get(r.agentId) ?? r.agentId,
    conversations: Number(r.count),
  }));

  return { totals, monthly, billing, topAgents };
}
