export interface Competitor {
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
  investment?: string;
  effort?: string;
  impact?: string;
  firstStep?: string;
}

export interface StudySection {
  key: string;
  title: string;
  markdown: string;
  /** Competidores estructurados (solo sección "competitors"); si existen, se pintan como tabla. */
  competitors?: Competitor[];
  /** Opciones recomendadas estructuradas (solo "recommended_options"); si existen, tarjetas. */
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
  websiteStatus?: WebsiteStatus;
  websiteUrl?: string;
  opportunityScore?: number;
  unverified?: boolean;
  lat?: number;
  lng?: number;
  distanceKm?: number;
  outOfRadius?: boolean;
}

export interface Study {
  id: string;
  title: string;
  inputs: any;
  sections: StudySection[];
  prospects: Prospect[];
  status: string;
  successScore?: number | null;
  createdAt: string;
  updatedAt: string;
  placesConfigured?: boolean;
}
