export const DECALOGUE_AREAS = [
  "purpose",
  "businessName",
  "palette",
  "style",
  "images",
  "sections",
  "cta",
  "contact",
  "database",
  "language",
] as const;

export type DecalogueArea = (typeof DECALOGUE_AREAS)[number];

export interface AnswerEntry {
  value: string;
  assumedByAI: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LandingProject {
  id: string;
  name: string;
  business: string | null;
  answers: Record<string, AnswerEntry>;
  chatMessages: ChatMessage[];
  generationPrompt: string | null;
  dbProvider: string;
  files: Record<string, string>;
  mobileFiles: Record<string, string>;
  mobileStack: string | null;
  qrUrl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}
