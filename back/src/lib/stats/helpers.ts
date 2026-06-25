import { Prisma } from "@/lib/generated/prisma/client";
import type {
  GranularityKey,
  StatsQuery,
  RawMonthCount,
  RawTopAgent,
  Totals,
  SkillTypeCount,
  BillingMonthPoint,
  BillingTotals,
  TopAgent,
} from "@/lib/stats/types";

// ── Helpers ────────────────────────────────────────────────────────────────

export function toYYYYMM(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function toYYYYMMDD(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${toYYYYMM(d)}-${day}`;
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
export function periodKey(d: Date, g: GranularityKey): string {
  if (g === "year") return toYYYY(d);
  if (g === "week") return isoWeek(d);
  if (g === "day") return toYYYYMMDD(d);
  return toYYYYMM(d);
}

/** Max number of zero-filled buckets — beyond this we return data-only keys. */
const MAX_FILL_PERIODS = 600;

/**
 * Enumerate every period key between start and end (inclusive) for a
 * granularity, so charts always receive a continuous, gap-free series.
 */
export function enumeratePeriods(start: Date, end: Date, g: GranularityKey): string[] {
  if (start.getTime() > end.getTime()) return [];

  // Align cursor to the start of its period (UTC)
  let cursor: Date;
  if (g === "year") {
    cursor = new Date(Date.UTC(start.getUTCFullYear(), 0, 1));
  } else if (g === "month") {
    cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  } else if (g === "week") {
    const aligned = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const dow = aligned.getUTCDay() || 7; // Mon=1 … Sun=7
    aligned.setUTCDate(aligned.getUTCDate() - (dow - 1));
    cursor = aligned;
  } else {
    cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  }

  const keys: string[] = [];
  while (cursor.getTime() <= end.getTime() && keys.length < MAX_FILL_PERIODS) {
    keys.push(periodKey(cursor, g));
    if (g === "year") cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
    else if (g === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else if (g === "week") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // Range too large to fill — caller falls back to data-derived keys
  if (cursor.getTime() <= end.getTime()) return [];
  return keys;
}

/** Returns the ISO string for 12 months ago (first day of that month, UTC). */
export function twelveMonthsAgo(): Date {
  const now = new Date();
  now.setUTCDate(1);
  now.setUTCHours(0, 0, 0, 0);
  now.setUTCMonth(now.getUTCMonth() - 11); // 11 prior months + current = 12 months
  return now;
}

/** Compute start date from range query */
export function rangeStart(query: StatsQuery): Date | null {
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

export function rangeEnd(query: StatsQuery): Date | null {
  if (query.range === "custom" && query.to) return new Date(query.to);
  return null;
}

/** Round to 2 decimal places to avoid IEEE 754 float noise in billing sums. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── In-memory reducers (puros, compartidos por getStats y getStatsP7) ────────

/** Indexa filas {month, count} por una clave de periodo derivada de la fecha. */
export function toCountMap(
  rows: RawMonthCount[],
  keyOf: (d: Date) => string
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(keyOf(r.month), Number(r.count));
  return m;
}

/** Estados de presupuesto que se agregan en la serie de facturación. */
const BILLING_STATUS_KEYS = ["draft", "sent", "accepted", "rejected"] as const;

/** Punto de facturación vacío (todos los importes a 0) para zero-fill. */
function emptyBillingMonth(month: string): BillingMonthPoint {
  return { month, total: 0, draft: 0, sent: 0, accepted: 0, rejected: 0 };
}

/** Estructura de las filas crudas de facturación (date_trunc + status + SUM). */
export interface RawBillingRowLike {
  month: Date;
  status: string;
  total: number | null;
}

/**
 * Acumula las filas crudas de facturación en un mapa por periodo + los totales
 * globales, redondeando cada suma con round2 para evitar ruido IEEE-754.
 */
export function accumulateBilling(
  rows: RawBillingRowLike[],
  keyOf: (d: Date) => string
): { monthMap: Map<string, BillingMonthPoint>; totals: BillingTotals } {
  const monthMap = new Map<string, BillingMonthPoint>();
  const totals: BillingTotals = { total: 0, draft: 0, sent: 0, accepted: 0, rejected: 0 };

  for (const r of rows) {
    const key = keyOf(r.month);
    if (!monthMap.has(key)) monthMap.set(key, emptyBillingMonth(key));
    const row = monthMap.get(key)!;
    const amount = round2(Number(r.total ?? 0));

    row.total = round2(row.total + amount);
    totals.total = round2(totals.total + amount);
    for (const s of BILLING_STATUS_KEYS) {
      if (r.status === s) {
        row[s] = round2(row[s] + amount);
        totals[s] = round2(totals[s] + amount);
      }
    }
  }
  return { monthMap, totals };
}

/** Entrada cruda para construir los totales globales (counts + groupBy). */
export interface RawTotalsInput {
  agents: number;
  clients: number;
  skills: number;
  skillsByType: { type: string; _count: { _all: number } }[];
  leads: number;
  leadsByStatus: { status: string; _count: { _all: number } }[];
  conversations: number;
  messages: number;
  automations: number;
  budgets: number;
}

/** Ensambla el objeto Totals a partir de counts y groupBy crudos de Prisma. */
export function buildTotals(i: RawTotalsInput): Totals {
  const skillsByType: SkillTypeCount[] = i.skillsByType.map((r) => ({
    type: r.type,
    count: r._count._all,
  }));
  const leadsByStatus: Record<string, number> = {};
  for (const r of i.leadsByStatus) leadsByStatus[r.status] = r._count._all;
  return {
    agents: i.agents,
    clients: i.clients,
    skills: i.skills,
    skillsByType,
    leads: i.leads,
    leadsByStatus,
    conversations: i.conversations,
    messages: i.messages,
    automations: i.automations,
    budgets: i.budgets,
  };
}

/** Mapea el top de agentes crudo a TopAgent, resolviendo nombre (fallback id). */
export function mapTopAgents(
  raw: RawTopAgent[],
  nameMap: Map<string, string>
): TopAgent[] {
  return raw.map((r) => ({
    agentId: r.agentId,
    agentName: nameMap.get(r.agentId) ?? r.agentId,
    conversations: Number(r.count),
  }));
}

/** Build date WHERE fragment for a column */
export function dateFragment(col: string, since: Date | null, until: Date | null): Prisma.Sql {
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
