import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { z } from "zod";

// ── Query schema ───────────────────────────────────────────────────────────

export const GRANULARITY_MAP = {
  year: "year",
  month: "month",
  week: "week",
} as const;

export type GranularityKey = keyof typeof GRANULARITY_MAP;

export const statsQuerySchema = z.object({
  granularity: z.enum(["year", "month", "week"]).optional(),
  range: z.enum(["last12m", "ytd", "all", "custom"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  clientId: z.string().optional(),
  serviceId: z.string().optional(),
  agentId: z.string().optional(),
  status: z.string().optional(),
  sector: z.string().optional(),
  revenueType: z.enum(["all", "impl", "maint"]).optional(),
}).refine((d) => {
  if (d.range === "custom" && (!d.from || !d.to)) return false;
  return true;
}, { message: "range=custom requiere from y to" });

export type StatsQuery = z.infer<typeof statsQuerySchema>;

// ── Types ──────────────────────────────────────────────────────────────────

export interface SkillTypeCount {
  type: string;
  count: number;
}

export interface Totals {
  agents: number;
  clients: number;
  skills: number;
  skillsByType: SkillTypeCount[];
  leads: number;
  leadsByStatus: Record<string, number>;
  conversations: number;
  messages: number;
  automations: number;
  budgets: number;
}

export interface MonthlyPoint {
  month: string; // "YYYY-MM" | "YYYY" | "YYYY-Www"
  agents: number;
  leads: number;
  conversations: number;
  budgets: number;
}

export interface BillingMonthPoint {
  month: string;
  total: number;
  draft: number;
  sent: number;
  accepted: number;
  rejected: number;
}

export interface BillingTotals {
  total: number;
  draft: number;
  sent: number;
  accepted: number;
  rejected: number;
}

export interface Billing {
  monthly: BillingMonthPoint[];
  totals: BillingTotals;
}

export interface TopAgent {
  agentId: string;
  agentName: string;
  conversations: number;
}

export interface StatsResponse {
  totals: Totals;
  monthly: MonthlyPoint[];
  billing: Billing;
  topAgents: TopAgent[];
}

// Drill-down

export interface DrilldownBudget {
  id: string;
  quoteNumber: string;
  clientName: string | null;
  totalImpl: number;
  totalMaint: number;
  status: string;
  createdAt: string;
}

export interface DrilldownLead {
  id: string;
  customerName: string;
  status: string;
  createdAt: string;
}

export interface DrilldownResponse {
  period: string;
  budgets: DrilldownBudget[];
  leads: DrilldownLead[];
}

// ── Raw query result shapes ────────────────────────────────────────────────

interface RawMonthCount {
  month: Date;
  count: bigint;
}

interface RawBillingRow {
  month: Date;
  status: string;
  total: number | null;
}

interface RawTopAgent {
  agentId: string;
  count: bigint;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toYYYYMM(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** ISO week number (Monday-start) */
function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function toYYYY(d: Date): string {
  return String(d.getUTCFullYear());
}

/** Format period key by granularity */
function periodKey(d: Date, g: GranularityKey): string {
  if (g === "year") return toYYYY(d);
  if (g === "week") return isoWeek(d);
  return toYYYYMM(d);
}

/** Returns the ISO string for 12 months ago (first day of that month, UTC). */
function twelveMonthsAgo(): Date {
  const now = new Date();
  now.setUTCDate(1);
  now.setUTCHours(0, 0, 0, 0);
  now.setUTCMonth(now.getUTCMonth() - 11); // 11 prior months + current = 12 months
  return now;
}

/** Compute start date from range query */
function rangeStart(query: StatsQuery): Date | null {
  const range = query.range ?? "last12m";
  if (range === "last12m") return twelveMonthsAgo();
  if (range === "ytd") {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }
  if (range === "all") return null;
  if (range === "custom" && query.from) return new Date(query.from);
  return twelveMonthsAgo();
}

function rangeEnd(query: StatsQuery): Date | null {
  if (query.range === "custom" && query.to) return new Date(query.to);
  return null;
}

/** Round to 2 decimal places to avoid IEEE 754 float noise in billing sums. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Build date WHERE fragment for a column */
function dateFragment(col: string, since: Date | null, until: Date | null): Prisma.Sql {
  if (since && until) {
    return Prisma.sql`AND ${Prisma.raw(`"${col}"`)} >= ${since} AND ${Prisma.raw(`"${col}"`)} <= ${until}`;
  }
  if (since) {
    return Prisma.sql`AND ${Prisma.raw(`"${col}"`)} >= ${since}`;
  }
  if (until) {
    return Prisma.sql`AND ${Prisma.raw(`"${col}"`)} <= ${until}`;
  }
  return Prisma.sql``;
}

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

  const monthly: MonthlyPoint[] = Array.from(allKeys).sort().map((key) => ({
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

  const billingMonthly: BillingMonthPoint[] = Array.from(billingMonthMap.values()).sort((a, b) =>
    a.month.localeCompare(b.month)
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

// ── Drill-down ─────────────────────────────────────────────────────────────

export async function getDrilldown(
  period: string,
  query?: StatsQuery
): Promise<DrilldownResponse> {
  // Parse period: "YYYY-MM", "YYYY", "YYYY-Www"
  let startDate: Date;
  let endDate: Date;

  if (/^\d{4}-W\d{2}$/.test(period)) {
    // ISO week: find Monday of that week
    const [yearStr, weekStr] = period.split("-W");
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);
    // Jan 4 is always in week 1
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const mon = jan4.getUTCDay() || 7; // Mon=1
    const weekStart = new Date(jan4.getTime() - (mon - 1) * 86400000 + (week - 1) * 7 * 86400000);
    startDate = weekStart;
    endDate = new Date(weekStart.getTime() + 7 * 86400000 - 1);
  } else if (/^\d{4}$/.test(period)) {
    const year = parseInt(period, 10);
    startDate = new Date(Date.UTC(year, 0, 1));
    endDate = new Date(Date.UTC(year + 1, 0, 1) - 1);
  } else {
    // YYYY-MM
    const [yearStr, monthStr] = period.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1;
    startDate = new Date(Date.UTC(year, month, 1));
    endDate = new Date(Date.UTC(year, month + 1, 1) - 1);
  }

  const budgetWhere: any = {
    createdAt: { gte: startDate, lte: endDate },
  };
  if (query?.clientId) budgetWhere.clientId = query.clientId;
  if (query?.status) budgetWhere.status = query.status;
  if (query?.serviceId) {
    budgetWhere.lines = { some: { serviceId: query.serviceId } };
  }
  if (query?.sector) {
    budgetWhere.client = { sector: query.sector };
  }

  const leadWhere: any = {
    createdAt: { gte: startDate, lte: endDate },
  };
  if (query?.agentId) leadWhere.agentId = query.agentId;

  const [budgets, leads] = await Promise.all([
    prisma.budget.findMany({
      where: budgetWhere,
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.lead.findMany({
      where: leadWhere,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    period,
    budgets: budgets.map((b) => ({
      id: b.id,
      quoteNumber: b.quoteNumber,
      clientName: b.client?.name ?? null,
      totalImpl: b.totalImpl,
      totalMaint: b.totalMaint,
      status: b.status,
      createdAt: b.createdAt.toISOString(),
    })),
    leads: leads.map((l) => ({
      id: l.id,
      customerName: l.customerName,
      status: l.status,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}
