// Shared formatting for chart period keys coming from the stats API.
// Keys: "YYYY" (year), "YYYY-MM" (month), "YYYY-Www" (ISO week), "YYYY-MM-DD" (day).

export interface PeriodMode {
  /** Effective granularity of the series being displayed. */
  granularity: "year" | "month" | "week" | "day";
  /** Selected range — drives month label style (full vs abbreviated). */
  range: "last12m" | "ytd" | "all";
}

export const MONTHS_FULL = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export const MONTHS_ABBR = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const YEAR_RE = /^\d{4}$/;

/**
 * X-axis tick label.
 * - Day keys → "1/06" (single-month drilldown).
 * - Week keys → "S23" ("S01 2026" at year boundaries / first tick).
 * - Month keys, range "all" → 3-letter abbreviations; January is replaced by
 *   the year ("… Nov Dic 2026 Feb …") so the year is always visible.
 * - Month keys, other ranges → full Spanish month names.
 * - Year keys → the year itself.
 */
export function formatPeriodTick(value: string, index: number, mode: PeriodMode): string {
  const day = DAY_RE.exec(value);
  if (day) return `${parseInt(day[3], 10)}/${day[2]}`;

  const week = WEEK_RE.exec(value);
  if (week) {
    if (index === 0 || week[2] === "01") return `S${week[2]} ${week[1]}`;
    return `S${week[2]}`;
  }

  const month = MONTH_RE.exec(value);
  if (month) {
    const [, year, mm] = month;
    const idx = parseInt(mm, 10) - 1;
    if (mode.range === "all") {
      if (mm === "01") return year; // year marker replaces January
      if (index === 0) return `${MONTHS_ABBR[idx]} ${year}`;
      return MONTHS_ABBR[idx] ?? value;
    }
    return MONTHS_FULL[idx] ?? value;
  }

  if (YEAR_RE.test(value)) return value;
  return value;
}

/**
 * Explicit X-axis ticks. In range "Todo" with many months, recharts would
 * auto-skip ticks and could drop the January ticks that carry the year — so
 * we pin the first point plus every January. Returns undefined when the
 * default auto behavior is fine.
 */
export function xAxisTicks(keys: string[], mode: PeriodMode): string[] | undefined {
  if (mode.granularity !== "month" || mode.range !== "all") return undefined;
  if (keys.length <= 24) return undefined;
  const januaries = keys.filter((k) => MONTH_RE.test(k) && k.endsWith("-01"));
  const ticks = keys[0] && !januaries.includes(keys[0]) ? [keys[0], ...januaries] : januaries;
  return ticks.length > 0 ? ticks : undefined;
}

/** Tooltip label: always unambiguous, with full month name and year. */
export function formatPeriodLabel(value: string): string {
  const day = DAY_RE.exec(value);
  if (day) {
    const idx = parseInt(day[2], 10) - 1;
    return `${parseInt(day[3], 10)} de ${MONTHS_FULL[idx]?.toLowerCase() ?? day[2]} de ${day[1]}`;
  }

  const week = WEEK_RE.exec(value);
  if (week) return `Semana ${parseInt(week[2], 10)} · ${week[1]}`;

  const month = MONTH_RE.exec(value);
  if (month) {
    const idx = parseInt(month[2], 10) - 1;
    return `${MONTHS_FULL[idx] ?? month[2]} ${month[1]}`;
  }

  if (YEAR_RE.test(value)) return `Año ${value}`;
  return value;
}
