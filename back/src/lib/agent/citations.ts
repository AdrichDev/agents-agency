/**
 * aa-agente-sin-inventar T2 (S2/AC2): a citation must be backed by what it cites.
 *
 * Deterministic post-processing of the final reply. For each "(fuente: X)" it takes the sentence
 * that carries it and requires lexical overlap with a fragment whose public source is X. Below
 * the threshold, or when X was never handed to the model, the citation is removed and the
 * sentence is kept. This does not make the model right; it stops it from being credibly wrong
 * (H4: a booking window turned into a kitchen closing time, with a real page cited). Removing a
 * citation is cheap and reversible; suppressing an answer is not, so nothing else is touched.
 */
import { publicSource } from "@/lib/embeddings";

/** Minimum share of the sentence's content words that must appear in the cited fragment. */
export const CITATION_MIN_OVERLAP = 0.5;

export interface CitableFragment {
  source?: string | null;
  content: string;
}

const CITATION = /\s*\(fuente:\s*([^)]+?)\s*\)/gi;

/** Short function words that carry no claim; numbers are always kept (they are the claim). */
const STOPWORDS = new Set([
  "para", "pero", "como", "este", "esta", "estos", "estas", "desde", "hasta", "sobre", "entre",
  "tambien", "cuando", "donde", "puede", "pueden", "todo", "todos", "toda", "todas", "muy",
  "nuestro", "nuestra", "nuestros", "nuestras", "tiene", "tienen", "hay", "son", "esta", "estan",
]);

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function words(text: string): string[] {
  return normalize(text).match(/[a-z0-9ñ]+/g) ?? [];
}

/** Content words of a claim: numbers of any length, other words of four letters or more. */
function contentWords(text: string): string[] {
  return words(text).filter((w) => (/^\d+$/.test(w) || w.length >= 4) && !STOPWORDS.has(w));
}

function sameSource(a: string, b: string): boolean {
  const clean = (s: string) => s.trim().replace(/\/+$/, "").toLowerCase();
  return clean(a) === clean(b);
}

/** The sentence a citation belongs to: the text before it, back to the previous boundary. */
function claimBefore(text: string): string {
  const trimmed = text.replace(/[\s.!?;:]+$/, "");
  const cut = Math.max(
    trimmed.lastIndexOf("."),
    trimmed.lastIndexOf("!"),
    trimmed.lastIndexOf("?"),
    trimmed.lastIndexOf("\n"),
  );
  return trimmed.slice(cut + 1);
}

function isBacked(claim: string, fragments: CitableFragment[], minOverlap: number): boolean {
  const claimWords = contentWords(claim);
  return fragments.some((f) => {
    const available = new Set(words(f.content));
    if (claimWords.length === 0) return minOverlap <= 0;
    const hits = claimWords.filter((w) => available.has(w)).length;
    return hits / claimWords.length >= minOverlap;
  });
}

/**
 * Returns the reply with every unsupported "(fuente: X)" removed. Fragment sources are compared
 * through `publicSource`, the same gate that decides what the model was allowed to see.
 */
export function enforceCitations(
  reply: string,
  fragments: CitableFragment[],
  minOverlap: number = CITATION_MIN_OVERLAP,
): string {
  if (!/\(fuente:/i.test(reply)) return reply;
  let out = "";
  let last = 0;
  for (const match of reply.matchAll(CITATION)) {
    const start = match.index ?? 0;
    const before = reply.slice(last, start);
    out += before;
    const cited = match[1];
    const candidates = fragments.filter((f) => {
      const src = publicSource(f.source ?? null);
      return src !== null && sameSource(src, cited);
    });
    const claim = claimBefore(out);
    if (candidates.length > 0 && isBacked(claim, candidates, minOverlap)) {
      out += match[0];
    }
    last = start + match[0].length;
  }
  // CITATION swallows the whitespace before it, so removal leaves no gap behind.
  return out + reply.slice(last);
}

/**
 * Fragments the model actually received during the turn: the prefetch rows plus every
 * `search_knowledge` result. Other tools never carry citable knowledge.
 */
export function citableFragments(
  prefetch: CitableFragment[] | null | undefined,
  toolCalls: { tool: string; output: unknown }[],
): CitableFragment[] {
  const fromTools = toolCalls
    .filter((t) => t.tool === "search_knowledge" && Array.isArray(t.output))
    .flatMap((t) => t.output as unknown[])
    .filter(
      (r): r is CitableFragment =>
        typeof r === "object" && r !== null && typeof (r as CitableFragment).content === "string",
    );
  return [...(prefetch ?? []), ...fromTools];
}
