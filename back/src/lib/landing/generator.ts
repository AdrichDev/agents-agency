/**
 * generator.ts — Genera el proyecto landing multi-archivo usando STRONG_MODEL.
 * Soporta generación inicial, regeneración con feedback y capa de datos.
 */

import { openai, STRONG_MODEL } from "@/lib/openai";
import { callWithRetry, MAX_FILES_BYTES, type FilesResult } from "./llm-files";

export type DbProvider = "none" | "local-postgres" | "firebase" | "supabase";

/** Snippets guía por proveedor de datos. */
const DATA_LAYER_HINTS: Record<Exclude<DbProvider, "none">, string> = {
  firebase: `Include a Firebase integration snippet in index.html:
- Add Firebase SDK via CDN: <script src="https://www.gstatic.com/firebasejs/..."></script>
- Initialize Firebase with placeholder config object (apiKey, authDomain, projectId)
- In the contact/form section, use addDoc() to save form submissions to a "submissions" collection
- Show a success/error message after form submission`,

  supabase: `Include a Supabase integration snippet in index.html:
- Add Supabase JS via CDN: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js"></script>
- Initialize client with placeholder URL and anon key
- In the contact/form section, use supabase.from('submissions').insert() to save form data
- Show a success/error message after form submission`,

  "local-postgres": `Include a local API integration snippet in index.html:
- In the contact/form section, use fetch('/api/submissions', { method: 'POST', body: JSON.stringify(formData) })
- Handle the response and show a success/error message
- No external SDK needed — pure fetch to the local backend`,
};

export interface GenerateOptions {
  previous?: Record<string, string>;  // existing files for regeneration/merge
  feedback?: string;                  // natural language feedback for regeneration
  onlyDataLayer?: boolean;            // only regenerate data layer files
}

/**
 * Generates landing page files using STRONG_MODEL.
 * @param generationPrompt - The main prompt describing the landing.
 * @param dbProvider - Which data layer to include.
 * @param opts - Optional: previous files + feedback for regeneration.
 */
export async function generateFiles(
  generationPrompt: string,
  dbProvider: DbProvider,
  opts: GenerateOptions = {}
): Promise<FilesResult> {
  const { previous, feedback, onlyDataLayer } = opts;
  const isRegeneration = !!(previous && feedback);
  const isDataLayerOnly = !!(previous && onlyDataLayer);

  const dataLayerInstructions =
    dbProvider !== "none"
      ? `\n\nDATA LAYER REQUIREMENTS:\n${DATA_LAYER_HINTS[dbProvider]}`
      : "";

  let systemPrompt: string;

  if (isDataLayerOnly) {
    systemPrompt = `You are a landing page code generator specialized in data layer integrations.
Given the existing landing page files, add or update ONLY the data layer integration files/snippets.
${dataLayerInstructions}

CRITICAL RULES:
- Return ONLY a JSON object { "path": "content" } — no markdown, no explanation
- Include ONLY the files that need to change for the data layer (typically just index.html changes)
- Do NOT return files that are unchanged
- All paths must be relative (e.g., "index.html", "styles.css")`;
  } else if (isRegeneration) {
    systemPrompt = `You are a landing page code generator. The user wants to update an existing landing page.
Return ONLY the files that need to change based on the feedback. Preserve all other files.

CURRENT FILES:
${JSON.stringify(Object.keys(previous ?? {}), null, 2)}

CRITICAL RULES:
- Return ONLY a JSON object { "path": "content" } — no markdown, no explanation
- Include ONLY changed/new files. Files not in your response will be kept as-is
- index.html MUST be included and MUST be responsive
- All paths must be relative (e.g., "index.html", "styles.css")`;
  } else {
    systemPrompt = `You are a landing page code generator. Create a complete multi-file landing page project.

MANDATORY TECHNICAL REQUIREMENTS:
- Every response MUST include "index.html" as the main file
- Landing MUST be responsive: include <meta name="viewport" content="width=device-width, initial-scale=1">
- Use Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Use vanilla JavaScript only (no React, no Vue, no Angular)
- Images: use https://picsum.photos/{width}/{height}?random={n} as placeholders UNLESS user specified own images
- Mobile-first design with proper breakpoints (sm:, md:, lg: Tailwind classes)
- Clean, professional HTML structure with semantic elements${dataLayerInstructions}

CRITICAL RULES:
- Return ONLY a JSON object { "path": "content" } — no markdown, no explanation
- All file content must be complete and valid (no placeholders, no "..." truncation)
- All paths must be relative (e.g., "index.html", "styles.css", "script.js")`;
  }

  const userContent = isRegeneration
    ? `User feedback: ${feedback}\n\nOriginal prompt: ${generationPrompt}`
    : isDataLayerOnly
    ? `Add ${dbProvider} data layer to this landing. Current files: ${JSON.stringify(previous)}`
    : generationPrompt;

  const result = await callWithRetry(STRONG_MODEL, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ], 16000);

  // For regeneration: merge delta with previous files
  if ((isRegeneration || isDataLayerOnly) && previous) {
    const merged = { ...previous, ...result.files };
    const mergedSize = JSON.stringify(merged).length;
    const truncated = mergedSize > MAX_FILES_BYTES;

    if (truncated) {
      console.warn(`[generator] Merged files exceed ${MAX_FILES_BYTES} bytes (${mergedSize}). Flagging as truncated.`);
    }

    return { files: merged, truncated };
  }

  return result;
}

/**
 * Computes which keys in delta collide with existing files.
 */
export function findCollisions(
  existing: Record<string, string>,
  delta: Record<string, string>
): string[] {
  return Object.keys(delta).filter((path) => path in existing);
}

/**
 * Generates a simple text diff showing changed lines for collision warnings.
 */
export function buildSimpleDiff(
  existing: Record<string, string>,
  delta: Record<string, string>,
  collisions: string[]
): string {
  return collisions
    .map((path) => {
      const before = (existing[path] ?? "").split("\n").slice(0, 5).join("\n");
      const after = (delta[path] ?? "").split("\n").slice(0, 5).join("\n");
      return `--- ${path} (existing, first 5 lines)\n${before}\n\n+++ ${path} (new, first 5 lines)\n${after}`;
    })
    .join("\n\n---\n\n");
}
