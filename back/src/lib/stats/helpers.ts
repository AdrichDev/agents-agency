import { Prisma } from "@/lib/generated/prisma/client";
import type { GranularityKey, StatsQuery } from "@/lib/stats/types";

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
