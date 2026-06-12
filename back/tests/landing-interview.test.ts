import { describe, it, expect, vi, beforeEach } from "vitest";
import { runInterviewTurn, DECALOGUE_AREAS } from "@/lib/landing/interview";

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

import { openai } from "@/lib/openai";

const mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;

function makeCompletion(content: string) {
  return {
    choices: [{ message: { content } }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runInterviewTurn — first turn (null message)", () => {
  it("returns first question when no answers exist", async () => {
    const llmResponse = JSON.stringify({
      capturedArea: null,
      capturedValue: "",
      assumedByAI: false,
      nextArea: "purpose",
      nextQuestion: "¿Cuál es el propósito principal de esta landing page?",
      done: false,
    });
    mockCreate.mockResolvedValueOnce(makeCompletion(llmResponse));

    const turn = await runInterviewTurn({}, null);

    expect(turn.done).toBe(false);
    expect(turn.question).toBeTruthy();
    expect(typeof turn.question).toBe("string");
  });
});

describe("runInterviewTurn — captures answers", () => {
  it("parses a valid JSON response and captures the answer", async () => {
    const llmResponse = JSON.stringify({
      capturedArea: "purpose",
      capturedValue: "Vender cursos online",
      assumedByAI: false,
      nextArea: "businessName",
      nextQuestion: "¿Cómo se llama tu negocio?",
      done: false,
    });
    mockCreate.mockResolvedValueOnce(makeCompletion(llmResponse));

    const turn = await runInterviewTurn({}, "Quiero vender cursos online");

    expect(turn.answers["purpose"]).toEqual({
      value: "Vender cursos online",
      assumedByAI: false,
    });
    expect(turn.done).toBe(false);
    expect(turn.question).toBe("¿Cómo se llama tu negocio?");
  });
});

describe("runInterviewTurn — delegación a IA (decide tú)", () => {
  it("marks assumedByAI true when user delegates", async () => {
    const llmResponse = JSON.stringify({
      capturedArea: "palette",
      capturedValue: "Azul corporativo y blanco",
      assumedByAI: true,
      nextArea: "style",
      nextQuestion: "¿Qué estilo visual prefieres?",
      done: false,
    });
    mockCreate.mockResolvedValueOnce(makeCompletion(llmResponse));

    const existingAnswers = {
      purpose: { value: "Consultoría", assumedByAI: false },
      businessName: { value: "Acme Corp", assumedByAI: false },
    };

    const turn = await runInterviewTurn(existingAnswers, "decide tú");

    expect(turn.answers["palette"]).toEqual({
      value: "Azul corporativo y blanco",
      assumedByAI: true,
    });
  });
});

describe("runInterviewTurn — JSON inválido → fallback determinista", () => {
  it("returns a fallback question without throwing when LLM returns invalid JSON", async () => {
    mockCreate.mockResolvedValueOnce(makeCompletion("not valid json at all!!!"));

    const turn = await runInterviewTurn({}, "algo");

    // Should NOT throw; should return a fallback question
    expect(turn.done).toBe(false);
    expect(typeof turn.question).toBe("string");
    expect(turn.question!.length).toBeGreaterThan(5);
  });
});

describe("runInterviewTurn — done when all areas answered", () => {
  it("returns done:true when all areas have answers", async () => {
    const allAnswers = Object.fromEntries(
      DECALOGUE_AREAS.map((a) => [a, { value: "test", assumedByAI: false }])
    );

    // No LLM call needed — function should short-circuit
    const turn = await runInterviewTurn(allAnswers, null);

    expect(turn.done).toBe(true);
    expect(turn.question).toBeNull();
    // No LLM call should have been made
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("sets done:true when LLM says done", async () => {
    const llmResponse = JSON.stringify({
      capturedArea: "language",
      capturedValue: "Español, tono formal",
      assumedByAI: false,
      nextArea: null,
      nextQuestion: null,
      done: true,
    });
    mockCreate.mockResolvedValueOnce(makeCompletion(llmResponse));

    // Only language is missing
    const almostDoneAnswers = Object.fromEntries(
      DECALOGUE_AREAS.filter((a) => a !== "language").map((a) => [
        a,
        { value: "val", assumedByAI: false },
      ])
    );

    const turn = await runInterviewTurn(almostDoneAnswers, "Español formal");

    expect(turn.done).toBe(true);
    expect(turn.question).toBeNull();
  });
});
