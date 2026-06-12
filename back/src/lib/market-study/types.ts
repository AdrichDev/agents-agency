// Types for market study module

export interface StudySection {
  key: string;
  title: string;
  markdown: string;
}

export type WebsiteStatus = "no_web" | "web_no_chatbot" | "web_chatbot";

export interface Prospect {
  placeId: string;
  name: string;
  address?: string;
  phone?: string;
  rating?: number;
  sector?: string;
  candidateServices: string[];
  status: "new" | "contacted" | "discarded";
  // Extended classification fields (P9)
  websiteStatus?: WebsiteStatus;
  websiteUrl?: string;
  opportunityScore?: number;  // 1-5 heuristic
  unverified?: boolean;       // true when website fetch failed
}

export interface MarketStudyInputs {
  zone: string;
  postalCode?: string;
  radiusKm: number;
  expansionZones: string[];
  targetSectors: string[];
  avgBudget?: number;
}

export type StudyStatus = "draft" | "generating" | "ready" | "error";

export interface RealBusinessData {
  acceptedBudgetCount: number;
  totalAcceptedRevenue: number;
  avgAcceptedTicket: number;
  activeClientCount: number;
  revenueByService: Array<{ serviceId: string; name: string; total: number }>;
  clientsBySector: Array<{ sector: string; count: number }>;
  revenueByServiceAndSector: Array<{ serviceId: string; sector: string; total: number }>;
}

export const STUDY_SECTION_KEYS = [
  "executive_summary",
  "swot",
  "target_segments",
  "zone_analysis",
  "suggested_pricing",
  "expansion_plan",
  "next_steps",
  "action_plan",
  "recommended_options",
  "competitors",
] as const;

export type StudySectionKey = typeof STUDY_SECTION_KEYS[number];

export const SECTION_TITLES: Record<StudySectionKey, string> = {
  executive_summary: "Resumen Ejecutivo",
  swot: "Análisis DAFO",
  target_segments: "Segmentos Objetivo",
  zone_analysis: "Análisis de Zona",
  suggested_pricing: "Pricing Sugerido",
  expansion_plan: "Plan de Expansión",
  next_steps: "Próximos Pasos",
  action_plan: "Plan de Acción",
  recommended_options: "Opciones Recomendadas de Actuación",
  competitors: "Competidores y Cómo Superarlos",
};
