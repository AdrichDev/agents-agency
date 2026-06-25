/**
 * prompt-master.ts — Genera el prompt de generación optimizado y 2-3 alternativos.
 * Carga la skill "prompt-master" de BD como guía; usa fallback embebido si no existe.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { openai, DEFAULT_MODEL } from "@/lib/openai";
import type { AnswerEntry } from "./interview";

// Fallback embebido si la skill no existe en BD
const FALLBACK_PROMPT_MASTER_GUIDE = `You are an expert landing page prompt engineer.
Given a set of business requirements, you craft highly detailed, specific generation prompts
that produce professional, responsive HTML/CSS/JS landing pages.
Your prompts always include: layout structure, color palette, typography, section order,
CTA placement, responsive breakpoints, and any data integration requirements.
Focus on clarity and specificity to maximize code quality from the code generation model.`;

export interface GenerationPrompts {
  generationPrompt: string;
  alternatives: string[];
}

/**
 * Builds the generation prompt and 2-3 alternatives based on decálogo answers.
 */
export async function buildGenerationPrompts(
  answers: Record<string, AnswerEntry>
): Promise<GenerationPrompts> {
  // Load prompt-master skill from DB
  let skillGuide = FALLBACK_PROMPT_MASTER_GUIDE;
  let usedFallback = true;

  try {
    const skill = await prisma.skill.findFirst({
      where: { name: { contains: "prompt-master" } },
    });

    if (skill) {
      skillGuide = skill.description;
      usedFallback = false;
    }
  } catch {
    // DB error — use fallback silently
  }

  if (usedFallback) {
    logger.warn("[prompt-master] Skill 'prompt-master' not found in DB. Using embedded fallback.");
  }

  const answersText = Object.entries(answers)
    .map(([area, entry]) => `- ${area}: ${entry.value}${entry.assumedByAI ? " (AI decided)" : ""}`)
    .join("\n");

  const systemPrompt = `${skillGuide}

Generate prompts for an HTML landing page generator. The prompts must instruct the code model to:
1. Create a responsive, mobile-first landing page (viewport meta tag, Tailwind CDN, CSS breakpoints).
2. Use only HTML + Tailwind CSS CDN + vanilla JS (no frameworks).
3. Use picsum.photos for placeholder images unless user has own images.
4. Follow the business requirements exactly.

Return ONLY a valid JSON object (no markdown):
{
  "generationPrompt": "<main detailed prompt>",
  "alternatives": ["<shorter variant>", "<different tone variant>", "<minimal variant>"]
}`;

  const userContent = `Business requirements from interview:\n${answersText}\n\nGenerate the landing page prompts.`;

  try {
    const completion = await openai.chat.completions.create({
      model: DEFAULT_MODEL,
      max_completion_tokens: 2000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    const parsed = JSON.parse(cleaned) as GenerationPrompts;

    if (!parsed.generationPrompt || !Array.isArray(parsed.alternatives)) {
      throw new Error("Invalid response structure");
    }

    return {
      generationPrompt: parsed.generationPrompt,
      alternatives: parsed.alternatives.slice(0, 3),
    };
  } catch (err) {
    logger.error({ err }, "[prompt-master] Failed to parse LLM response:");
    // Return a basic fallback prompt derived from answers
    const businessName = answers["businessName"]?.value ?? "Business";
    const purpose = answers["purpose"]?.value ?? "landing page";
    const palette = answers["palette"]?.value ?? "modern colors";

    const fallback = `Create a professional, responsive landing page for "${businessName}".
Purpose: ${purpose}. Color palette: ${palette}.
Requirements: viewport meta tag, Tailwind CSS CDN, vanilla JS, picsum.photos placeholders,
mobile-first responsive design, clear CTA buttons, smooth scrolling navigation.
Output as single HTML file with embedded CSS and JS.`;

    return {
      generationPrompt: fallback,
      alternatives: [
        `Build a minimal landing page for "${businessName}" with ${palette} colors. Tailwind CDN, responsive, vanilla JS.`,
        `Design a modern landing page for "${businessName}": ${purpose}. Mobile-first, Tailwind CDN, placeholder images from picsum.photos.`,
      ],
    };
  }
}
