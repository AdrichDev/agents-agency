import { prisma } from "@/lib/db";
import type { StatsQuery, DrilldownResponse } from "@/lib/stats/types";

// ── Drill-down ─────────────────────────────────────────────────────────────

export async function getDrilldown(
  period: string,
  query?: StatsQuery
): Promise<DrilldownResponse> {
  // Parse period: "YYYY-MM-DD", "YYYY-MM", "YYYY", "YYYY-Www"
  let startDate: Date;
  let endDate: Date;

  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    // Single day
    const [y, m, d] = period.split("-").map((n) => parseInt(n, 10));
    startDate = new Date(Date.UTC(y, m - 1, d));
    endDate = new Date(Date.UTC(y, m - 1, d + 1) - 1);
  } else if (/^\d{4}-W\d{2}$/.test(period)) {
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
