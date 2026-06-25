/**
 * serialization.ts — Coerce persisted landing JSON fields into typed maps and
 * derive mobile branding from the interview answers. Pure helpers, no I/O.
 * Extracted from routes/landing.ts.
 */

import type { AnswerEntry } from "./interview";

/** Coerce a persisted `answers` value into a keyed AnswerEntry map. */
export function parseAnswers(raw: unknown): Record<string, AnswerEntry> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, AnswerEntry>;
  }
  return {};
}

/** Coerce a persisted `files` value into a path → content map. */
export function parseFiles(raw: unknown): Record<string, string> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, string>;
  }
  return {};
}

export interface MobileBranding {
  businessName: string;
  palette: string;
  style: string;
  sections: string;
}

/** Derive mobile scaffold branding from interview answers, with sane fallbacks. */
export function buildMobileBranding(
  answers: Record<string, AnswerEntry>,
  fallbackBusiness?: string | null
): MobileBranding {
  return {
    businessName: answers["businessName"]?.value ?? fallbackBusiness ?? "Business",
    palette: answers["palette"]?.value ?? "modern colors",
    style: answers["style"]?.value ?? "modern",
    sections: answers["sections"]?.value ?? "home, about, contact",
  };
}
