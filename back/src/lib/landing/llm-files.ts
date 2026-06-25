/**
 * llm-files.ts — Helper compartido para parseo, validación y reintento de
 * respuestas LLM que devuelven un mapa de archivos { path → content }.
 */

import { openai } from "@/lib/openai";
import { logger } from "@/lib/logger";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export const MAX_FILES_BYTES = 300_000;

export interface FilesResult {
  files: Record<string, string>;
  truncated: boolean;
}

export interface ParseOptions {
  requireIndexHtml?: boolean; // default true for landing pages; false for mobile
}

/** Elimina bloques markdown, parsea JSON y valida la estructura {path→content}. */
export function parseAndValidateFiles(
  raw: string,
  opts: ParseOptions = {}
): Record<string, string> {
  const { requireIndexHtml = true } = opts;

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  const parsed: unknown = JSON.parse(cleaned);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error("Expected a plain object { path → content }");
  }

  // All values must be strings
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof val !== "string") {
      throw new Error(`File content for "${key}" is not a string`);
    }
  }

  const files = parsed as Record<string, string>;

  if (requireIndexHtml && !Object.keys(files).includes("index.html")) {
    throw new Error('Missing required file "index.html" in generated output');
  }

  return files;
}

/**
 * Calls the LLM with up to 2 retries if JSON parsing/validation fails.
 * Returns { files, truncated }.
 */
export async function callWithRetry(
  model: string,
  messages: ChatCompletionMessageParam[],
  maxTokens: number,
  parseOpts: ParseOptions = {}
): Promise<FilesResult> {
  let lastRaw = "";
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const msgs: ChatCompletionMessageParam[] =
      attempt === 0
        ? messages
        : [
            ...messages,
            {
              role: "assistant" as const,
              content: lastRaw,
            },
            {
              role: "user" as const,
              content:
                "Your previous response was not valid JSON { path: content }. " +
                "Return ONLY the JSON object with no markdown, no explanation. " +
                `Error: ${String(lastError)}`,
            },
          ];

    const completion = await openai.chat.completions.create({
      model,
      max_completion_tokens: maxTokens,
      messages: msgs,
    });

    lastRaw = completion.choices[0]?.message?.content?.trim() ?? "";

    try {
      const files = parseAndValidateFiles(lastRaw, parseOpts);
      const serialized = JSON.stringify(files);
      const truncated = serialized.length > MAX_FILES_BYTES;
      if (truncated) {
        logger.warn(
          `[llm-files] Generated files exceed ${MAX_FILES_BYTES} bytes (${serialized.length}). Flagging as truncated.`
        );
      }
      return { files, truncated };
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        logger.warn(`[llm-files] Attempt ${attempt + 1} failed: ${String(err)}. Retrying...`);
      }
    }
  }

  // All 3 attempts failed
  throw Object.assign(
    new Error(`Failed to parse LLM response as files JSON after 3 attempts: ${String(lastError)}`),
    { raw: lastRaw }
  );
}
