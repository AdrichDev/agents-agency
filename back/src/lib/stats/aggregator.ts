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
  accumulateBilling,
} from "@/lib/stats/helpers";
import { fetchTotals, fetchTopAgents, monthlyCount, billingQuery } from "@/lib/stats/queries";

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
  const totals: Totals = await fetchTotals();

  // ── Build filter fragments ───────────────────────────────────────────
  const clientFilter: Prisma.Sql = query.clientId
    ? Prisma.sql`AND b."tenant_id" = ${query.clientId}`
    : Prisma.sql``;

  const sectorFilter: Prisma.Sql = query.sector
    ? Prisma.sql`AND c."sector" = ${query.sector}`
    : Prisma.sql``;

  const sectorJoin: Prisma.Sql = query.sector
    ? Prisma.sql`JOIN "aa"."tenant" c ON b."tenant_id" = c."id"`
    : Prisma.sql``;

  const statusFilter: Prisma.Sql = query.status
    ? Prisma.sql`AND b."estado" = ${query.status}`
    : Prisma.sql``;

  // serviceId via BudgetLine
  const serviceJoin: Prisma.Sql = query.serviceId
    ? Prisma.sql`JOIN "aa"."linea_presupuesto" bl ON bl."presupuesto_id" = b."id" AND bl."servicio_id" = ${query.serviceId}`
    : Prisma.sql``;

  // revenueType for billing SUM
  const revenueExpr: Prisma.Sql = (() => {
    const rt = query.revenueType ?? "all";
    if (rt === "impl") return Prisma.sql`SUM(b."total_impl")::float`;
    if (rt === "maint") return Prisma.sql`SUM(b."total_mant")::float`;
    return Prisma.sql`SUM(b."total_impl" + b."total_mant")::float`;
  })();

  const dateSince = since;
  const dateUntil = until;

  // ── Monthly series (Lead + Budget with optional filters) ────────────
  // Use date_trunc with whitelisted literal unit
  // We use Prisma.raw ONLY for the whitelisted dtUnit constant, not user input
  const dtUnitSql = Prisma.raw(`'${dtUnit}'`);

  const dateFragB: Prisma.Sql = (() => {
    if (dateSince && dateUntil) return Prisma.sql`AND b."creado_en" >= ${dateSince} AND b."creado_en" <= ${dateUntil}`;
    if (dateSince) return Prisma.sql`AND b."creado_en" >= ${dateSince}`;
    if (dateUntil) return Prisma.sql`AND b."creado_en" <= ${dateUntil}`;
    return Prisma.sql``;
  })();

  const dateFragL: Prisma.Sql = (() => {
    if (dateSince && dateUntil) return Prisma.sql`AND l."creado_en" >= ${dateSince} AND l."creado_en" <= ${dateUntil}`;
    if (dateSince) return Prisma.sql`AND l."creado_en" >= ${dateSince}`;
    if (dateUntil) return Prisma.sql`AND l."creado_en" <= ${dateUntil}`;
    return Prisma.sql``;
  })();

  // Lead monthly (only date + agentId filter applicable)
  const agentFilterL: Prisma.Sql = query.agentId
    ? Prisma.sql`AND l."agente_id" = ${query.agentId}`
    : Prisma.sql``;

  const rawLeadMonths = await monthlyCount({
    from: Prisma.sql`"aa"."lead" l`,
    tsCol: Prisma.sql`l."creado_en"`,
    unit: dtUnitSql,
    where: Prisma.sql`1=1 ${dateFragL} ${agentFilterL}`,
  });

  // Budget monthly with filters
  const rawBudgetMonths = await monthlyCount({
    from: Prisma.sql`"aa"."presupuesto" b`,
    tsCol: Prisma.sql`b."creado_en"`,
    unit: dtUnitSql,
    joins: Prisma.sql`${serviceJoin} ${sectorJoin}`,
    where: Prisma.sql`1=1 ${dateFragB} ${clientFilter} ${sectorFilter} ${statusFilter}`,
  });

  // Agent + conversation monthly (no budget filters)
  const dateFragA: Prisma.Sql = (() => {
    if (dateSince && dateUntil) return Prisma.sql`AND "creado_en" >= ${dateSince} AND "creado_en" <= ${dateUntil}`;
    if (dateSince) return Prisma.sql`AND "creado_en" >= ${dateSince}`;
    if (dateUntil) return Prisma.sql`AND "creado_en" <= ${dateUntil}`;
    return Prisma.sql``;
  })();

  const agentFilterC: Prisma.Sql = query.agentId
    ? Prisma.sql`AND "agente_id" = ${query.agentId}`
    : Prisma.sql``;

  const [rawAgentMonths, rawConvMonths] = await Promise.all([
    monthlyCount({
      from: Prisma.sql`"aa"."agente"`,
      tsCol: Prisma.sql`"creado_en"`,
      unit: dtUnitSql,
      where: Prisma.sql`1=1 ${dateFragA}`,
    }),
    monthlyCount({
      from: Prisma.sql`"aa"."conversacion"`,
      tsCol: Prisma.sql`"creado_en"`,
      unit: dtUnitSql,
      where: Prisma.sql`1=1 ${dateFragA} ${agentFilterC}`,
    }),
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

  const rawBilling = await billingQuery<RawBillingFiltered>({
    unit: dtUnitSql,
    revenueExpr,
    from: Prisma.sql`"aa"."presupuesto" b`,
    joins: Prisma.sql`${serviceJoin} ${sectorJoin}`,
    where: Prisma.sql`1=1 ${dateFragB} ${clientFilter} ${sectorFilter} ${statusFilter}`,
  });

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
  const topAgents: TopAgent[] = await fetchTopAgents();

  return { totals, monthly, billing, topAgents };
}

// ── P7 no-params path (byte-identical to original) ────────────────────────

async function getStatsP7(): Promise<StatsResponse> {
  const since = twelveMonthsAgo();

  const totals: Totals = await fetchTotals();

  // Unidad fija 'month' para el path P7 (date_trunc('month', ...)).
  const unit = Prisma.raw(`'month'`);
  const where = Prisma.sql`"creado_en" >= ${since}`;

  const [rawAgentMonths, rawLeadMonths, rawConvMonths, rawBudgetMonths] =
    await Promise.all([
      monthlyCount({ from: Prisma.sql`"aa"."agente"`, tsCol: Prisma.sql`"creado_en"`, unit, where }),
      monthlyCount({ from: Prisma.sql`"aa"."lead"`, tsCol: Prisma.sql`"creado_en"`, unit, where }),
      monthlyCount({ from: Prisma.sql`"aa"."conversacion"`, tsCol: Prisma.sql`"creado_en"`, unit, where }),
      monthlyCount({ from: Prisma.sql`"aa"."presupuesto"`, tsCol: Prisma.sql`"creado_en"`, unit, where }),
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

  // Billing P7: ingresos totales (impl + mant). Se aliasa la tabla como b para
  // compartir billingQuery con el path filtrado; resultado idéntico al original.
  const rawBilling = await billingQuery<RawBillingRow>({
    unit,
    revenueExpr: Prisma.sql`SUM(b."total_impl" + b."total_mant")::float`,
    from: Prisma.sql`"aa"."presupuesto" b`,
    where: Prisma.sql`b."creado_en" >= ${since}`,
  });

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

  const topAgents: TopAgent[] = await fetchTopAgents();

  return { totals, monthly, billing, topAgents };
}
