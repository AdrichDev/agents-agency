// Types for market study module

export interface CompetitorRow {
  placeId: string;
  name: string;
  website?: string;
  email?: string;
  rating?: number;
  services?: string;
}

export interface RecommendedOption {
  title: string;
  description: string;
  successScore: number;
  rationale?: string;
  investment?: string; // inversión estimada
  effort?: string;     // esfuerzo requerido
  impact?: string;     // impacto esperado
  firstStep?: string;  // primer paso concreto
}

export interface StudySection {
  key: string;
  title: string;
  markdown: string;
  /** Competidores estructurados (solo en la sección "competitors"). Se guarda dentro del
   *  JSON de sections → sin migración. El front lo pinta como tabla; fallback al markdown. */
  competitors?: CompetitorRow[];
  /** Opciones recomendadas estructuradas (solo "recommended_options"). El front las pinta
   *  como tarjetas; fallback al markdown. */
  options?: RecommendedOption[];
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
  // Geolocation + radius bookkeeping
  lat?: number;
  lng?: number;
  distanceKm?: number;        // distance from the current study center (km)
  outOfRadius?: boolean;      // true when beyond the current action radius
}

export interface MarketStudyInputs {
  zone: string;
  postalCode?: string;
  radiusKm: number;
  expansionZones: string[];
  targetSectors: string[];
  avgBudget?: number;
}

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
