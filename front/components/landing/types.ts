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

/** Design reference requested by the owner: a public URL or an HTML file. */
export type LandingReference =
  | { url: string }
  | { file: { name: string; content: string } };

/** Guidelines extracted by the backend. Never text, images or logo from the source. */
export interface LandingReferenceInfo {
  kind: "url" | "file";
  /** Hostname of the URL or base name of the uploaded file. */
  source: string;
  structure: string[];
  /** Hex colours (#rrggbb). */
  palette: string[];
  fonts: string[];
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
