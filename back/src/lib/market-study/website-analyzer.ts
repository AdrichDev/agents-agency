import type { WebsiteStatus } from "./types";
import { safeFetch } from "@/lib/ssrf";

// Chatbot platform HTML signatures (lowercased)
const CHATBOT_SIGNATURES = [
  "intercom",
  "crisp.chat",
  "tawk.to",
  "tidio",
  "drift",
  "zendesk",
  "zopim",
  "hubspot",
  "manychat",
  "landbot",
  "botpress",
  "livechat",
  "wa.me",
  "api.whatsapp.com",
  "chatbot",
];

const FETCH_TIMEOUT_MS = 8_000;

export interface WebsiteAnalysisResult {
  websiteStatus: "web_chatbot" | "web_no_chatbot";
  unverified?: boolean;
}

/**
 * Fetches a business website and detects the presence of a chatbot via HTML signatures.
 * On fetch failure: returns web_no_chatbot + unverified: true (never throws).
 */
export async function analyzeWebsite(url: string): Promise<WebsiteAnalysisResult> {
  try {
    const res = await safeFetch(url, {
      headers: { "User-Agent": "MarketStudyBot/1.0" },
      timeoutMs: FETCH_TIMEOUT_MS,
      allowRedirects: true,
    });
    if (!res.ok) {
      return { websiteStatus: "web_no_chatbot", unverified: true };
    }
    const html = await res.text();

    const lower = html.toLowerCase();
    const hasChatbot = CHATBOT_SIGNATURES.some((sig) => lower.includes(sig));
    return { websiteStatus: hasChatbot ? "web_chatbot" : "web_no_chatbot" };
  } catch {
    return { websiteStatus: "web_no_chatbot", unverified: true };
  }
}

/**
 * Heuristic opportunity score for a prospect.
 *
 * Base scores:
 *   no_web          → 5  (best opportunity: no digital presence)
 *   web_no_chatbot  → 4  (has web but no chatbot)
 *   web_no_chatbot  → 3  (unverified: fetch failed, lower confidence)
 *   web_chatbot     → 2  (already has chatbot solution)
 *
 * Rating adjustments (Google Places rating 1-5):
 *   rating < 3.5 → +1 (low-rated business: easier to win with AI improvement)
 *   rating > 4.2 → -1 (strong competitor: harder to displace)
 *
 * Result clamped to [1, 5].
 */
export function computeOpportunityScore(
  websiteStatus: WebsiteStatus,
  unverified: boolean,
  rating?: number
): number {
  let base: number;

  switch (websiteStatus) {
    case "no_web":
      base = 5;
      break;
    case "web_no_chatbot":
      base = unverified ? 3 : 4;
      break;
    case "web_chatbot":
      base = 2;
      break;
    default:
      base = 3;
  }

  if (rating !== undefined) {
    if (rating < 3.5) base = Math.min(5, base + 1);
    else if (rating > 4.2) base = Math.max(1, base - 1);
  }

  return Math.max(1, Math.min(5, base));
}
