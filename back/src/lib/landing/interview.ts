/**
 * interview.ts — Decálogo conversacional del Landing Builder.
 * Conduce ~10 preguntas iterativas usando DEFAULT_MODEL.
 * Soporta "decide tú" (delegación a IA) y adapta el orden dinámicamente.
 */

import { openai, DEFAULT_MODEL } from "@/lib/openai";

/** Las 10 áreas del decálogo (orden por defecto). */
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

export interface InterviewTurn {
  answers: Record<string, AnswerEntry>;
  question: string | null; // null ⇒ decálogo completo
  done: boolean;
  area: string | null; // área que se acaba de capturar / pregunta actual
}

/** Respuesta JSON interna que esperamos del LLM. */
interface LLMInterviewResponse {
  capturedArea: string | null;
  capturedValue: string;
  assumedByAI: boolean;
  nextArea: string | null;
  nextQuestion: string | null;
  done: boolean;
}

/**
 * Ejecuta un turno del decálogo conversacional.
 * @param answers - Respuestas acumuladas hasta ahora.
 * @param userMessage - null en el primer turno (arranque); texto del usuario en siguientes.
 */
export async function runInterviewTurn(
  answers: Record<string, AnswerEntry>,
  userMessage: string | null
): Promise<InterviewTurn> {
  const pending = DECALOGUE_AREAS.filter((a) => !(a in answers));
  const isDone = pending.length === 0;

  if (isDone) {
    return { answers, question: null, done: true, area: null };
  }

  const systemPrompt = `You are a friendly assistant helping a user build a landing page.
You conduct an interview with exactly ${DECALOGUE_AREAS.length} areas: ${DECALOGUE_AREAS.join(", ")}.
Current answers: ${JSON.stringify(answers)}
Pending areas: ${pending.join(", ")}

Instructions:
- If the user says "decide tú", "decide tu", "lo que veas", "tú decides", or any equivalent delegation phrase, generate a reasonable value for the last asked area and set assumedByAI to true.
- Adapt the order of questions based on previous answers (e.g., if purpose is "restaurant" ask about menu sections next).
- Return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "capturedArea": "<area name or null if first turn or no new capture>",
  "capturedValue": "<value for capturedArea, or empty string if none>",
  "assumedByAI": false,
  "nextArea": "<next pending area to ask or null if done>",
  "nextQuestion": "<question to ask in Spanish for nextArea, or null if done>",
  "done": false
}
When ALL areas have been answered (including the one just captured), set done to true and nextQuestion to null.`;

  const userContent =
    userMessage === null
      ? `Start the interview. Ask the first question in Spanish.`
      : userMessage;

  let llmResult: LLMInterviewResponse | null = null;

  try {
    const completion = await openai.chat.completions.create({
      model: DEFAULT_MODEL,
      max_completion_tokens: 800,
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
    llmResult = JSON.parse(cleaned) as LLMInterviewResponse;
  } catch {
    // Fallback determinista: pregunta la siguiente área pendiente en orden por defecto
    llmResult = null;
  }

  // Merge captured answer (if any)
  const updatedAnswers = { ...answers };

  if (llmResult && llmResult.capturedArea && llmResult.capturedValue) {
    updatedAnswers[llmResult.capturedArea] = {
      value: llmResult.capturedValue,
      assumedByAI: llmResult.assumedByAI ?? false,
    };
  }

  const stillPending = DECALOGUE_AREAS.filter((a) => !(a in updatedAnswers));
  const nowDone = stillPending.length === 0 || (llmResult?.done ?? false);

  if (nowDone) {
    return { answers: updatedAnswers, question: null, done: true, area: llmResult?.capturedArea ?? null };
  }

  // Determine next question
  let nextQuestion: string;
  let nextArea: string;

  if (llmResult && llmResult.nextQuestion && llmResult.nextArea) {
    nextQuestion = llmResult.nextQuestion;
    nextArea = llmResult.nextArea;
  } else {
    // Fallback determinista
    nextArea = stillPending[0];
    nextQuestion = getFallbackQuestion(nextArea);
  }

  return {
    answers: updatedAnswers,
    question: nextQuestion,
    done: false,
    area: nextArea,
  };
}

/** Preguntas fallback por área si el LLM no responde con JSON válido. */
function getFallbackQuestion(area: string): string {
  const questions: Record<string, string> = {
    purpose: "¿Cuál es el propósito principal de esta landing page?",
    businessName: "¿Cómo se llama tu negocio o proyecto?",
    palette: "¿Qué colores quieres usar? (p.ej. azul y blanco, rojo y negro...)",
    style: "¿Qué estilo visual prefieres? (minimalista, corporativo, moderno, colorido...)",
    images: "¿Tienes imágenes propias para usar o prefieres placeholders?",
    sections: "¿Qué secciones quieres en la landing? (hero, sobre nosotros, servicios, contacto...)",
    cta: "¿Cuál es el texto o acción principal del botón CTA? (p.ej. 'Contáctanos', 'Comprar ahora')",
    contact: "¿Qué datos de contacto o redes sociales quieres mostrar?",
    database: "¿Necesitas guardar datos del formulario en alguna base de datos? (Firebase, Supabase, o no)",
    language: "¿En qué idioma y tono debe estar la landing? (español formal, inglés, casual...)",
  };
  return questions[area] ?? `¿Puedes contarme más sobre ${area}?`;
}
