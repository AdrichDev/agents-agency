// Email extraction from scraped competitor HTML.
// Looks for mailto: links first (highest confidence), then plain-text patterns.

const MAILTO_RE = /mailto:([^"'?\s>]+)/gi;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}/g;

// Domains/patterns that are never real contact addresses
const JUNK_DOMAIN_PARTS = [
  "example.com",
  "example.org",
  "sentry.io",
  "wixpress.com",
  "sentry-next.wixpress.com",
  "schema.org",
  "yourdomain",
  "domain.com",
  "email.com",
];

// File-like "emails" picked up from asset names (logo@2x.png, etc.)
const ASSET_EXT_RE = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot|mp4|webm|pdf)$/i;

const MAX_EMAILS = 3;

function isJunk(email: string): boolean {
  const lower = email.toLowerCase();
  if (ASSET_EXT_RE.test(lower)) return true;
  if (JUNK_DOMAIN_PARTS.some((d) => lower.endsWith(`@${d}`) || lower.includes(`.${d}`))) return true;
  // Hash-like local parts (build artifacts such as "a1b2c3d4e5f6...@2x")
  const [local] = lower.split("@");
  if (local.length > 40) return true;
  return false;
}

/**
 * Extracts up to MAX_EMAILS unique contact emails from raw HTML.
 * mailto: hrefs are ranked first; plain-text matches come after.
 */
export function extractEmails(html: string): string[] {
  if (!html) return [];

  const ordered: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    // mailto links may be URL-encoded
    let candidate = raw;
    try {
      candidate = decodeURIComponent(raw);
    } catch {
      // keep raw on malformed encoding
    }
    const match = candidate.match(EMAIL_RE);
    if (!match) return;
    const email = match[0].toLowerCase();
    if (seen.has(email) || isJunk(email)) return;
    seen.add(email);
    ordered.push(email);
  };

  for (const m of html.matchAll(MAILTO_RE)) push(m[1]);
  for (const m of html.matchAll(EMAIL_RE)) push(m[0]);

  return ordered.slice(0, MAX_EMAILS);
}
