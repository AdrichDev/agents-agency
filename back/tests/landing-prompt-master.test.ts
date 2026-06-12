import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildGenerationPrompts } from "@/lib/landing/prompt-master";

// Mock openai module
vi.mock("@/lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  DEFAULT_MODEL: "test-model",
  STRONG_MODEL: "test-strong-model",
}));

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    skill: {
      findFirst: vi.fn(),
    },
  },
}));

import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";

const mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.skill.findFirst as ReturnType<typeof vi.fn>;

function makeCompletion(content: string) {
  return { choices: [{ message: { content } }] };
}

const sampleAnswers = {
  purpose: { value: "Vender cursos de programación", assumedByAI: false },
  businessName: { value: "CodeAcademy Pro", assumedByAI: false },
  palette: { value: "Azul y blanco", assumedByAI: false },
  style: { value: "Moderno y limpio", assumedByAI: false },
  images: { value: "Usar placeholders", assumedByAI: false },
  sections: { value: "Hero, Cursos, Testimonios, CTA, Contacto", assumedByAI: false },
  cta: { value: "Empieza a aprender ahora", assumedByAI: false },
  contact: { value: "info@codeacademy.pro", assumedByAI: false },
  database: { value: "none", assumedByAI: false },
  language: { value: "Español, tono profesional", assumedByAI: false },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildGenerationPrompts — skill in DB", () => {
  it("uses skill description as guide when skill exists in DB", async () => {
    const skillGuide = "Expert landing page prompt engineer with advanced techniques.";
    mockFindFirst.mockResolvedValueOnce({
      id: "skill-1",
      name: "nidhinjs/prompt-master",
      description: skillGuide,
    });

    const promptResponse = {
      generationPrompt: "Create a professional landing for CodeAcademy Pro...",
      alternatives: ["Short variant", "Different tone variant"],
    };
    mockCreate.mockResolvedValueOnce(makeCompletion(JSON.stringify(promptResponse)));

    const result = await buildGenerationPrompts(sampleAnswers);

    expect(result.generationPrompt).toBeTruthy();
    expect(Array.isArray(result.alternatives)).toBe(true);
    expect(result.alternatives.length).toBeGreaterThanOrEqual(1);

    // Verify the skill was fetched from DB
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { name: { contains: "prompt-master" } },
    });
  });
});

describe("buildGenerationPrompts — fallback when skill absent", () => {
  it("returns generationPrompt and alternatives without throwing when skill is not in DB", async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    const promptResponse = {
      generationPrompt: "Build a landing page for CodeAcademy Pro...",
      alternatives: ["Variant 1", "Variant 2", "Variant 3"],
    };
    mockCreate.mockResolvedValueOnce(makeCompletion(JSON.stringify(promptResponse)));

    const result = await buildGenerationPrompts(sampleAnswers);

    expect(result.generationPrompt).toBeTruthy();
    expect(Array.isArray(result.alternatives)).toBe(true);
    // No error thrown — fallback used silently
  });

  it("returns fallback prompt even when LLM also fails", async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockRejectedValueOnce(new Error("LLM unavailable"));

    const result = await buildGenerationPrompts(sampleAnswers);

    // Should return a fallback prompt derived from answers
    expect(result.generationPrompt).toContain("CodeAcademy Pro");
    expect(Array.isArray(result.alternatives)).toBe(true);
  });
});

describe("buildGenerationPrompts — response structure", () => {
  it("limits alternatives to 3", async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    const promptResponse = {
      generationPrompt: "Detailed prompt...",
      alternatives: ["Alt 1", "Alt 2", "Alt 3", "Alt 4", "Alt 5"],
    };
    mockCreate.mockResolvedValueOnce(makeCompletion(JSON.stringify(promptResponse)));

    const result = await buildGenerationPrompts(sampleAnswers);

    expect(result.alternatives.length).toBeLessThanOrEqual(3);
  });
});
