import { z } from "zod";

// ── Query schema ───────────────────────────────────────────────────────────

export const GRANULARITY_MAP = {
  year: "year",
  month: "month",
  week: "week",
  day: "day",
} as const;

export type GranularityKey = keyof typeof GRANULARITY_MAP;

export const statsQuerySchema = z.object({
  granularity: z.enum(["year", "month", "week", "day"]).optional(),
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

export interface RawMonthCount {
  month: Date;
  count: bigint;
}

export interface RawBillingRow {
  month: Date;
  status: string;
  total: number | null;
}

export interface RawTopAgent {
  agentId: string;
  count: bigint;
}
