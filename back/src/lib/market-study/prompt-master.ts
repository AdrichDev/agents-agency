/**
 * prompt-master.ts (market study) — Genera el prompt de iteración óptimo para un
 * estudio de mercado. Carga la skill "prompt-master" del marketplace (BD) como
 * guía meta y la combina con NUESTRO core de negocio, la selección actual del
 * estudio y los datos reales de prospección.
 */

import { prisma } from "@/lib/db";
import { openai, DEFAULT_MODEL } from "@/lib/openai";
import { AGENCY_PROFILE } from "./agency-profile";
import type { MarketStudyInputs, RealBusinessData } from "./types";

const FALLBACK_PROMPT_MASTER_GUIDE = `You are an expert prompt engineer. Given a goal and context, you craft a single,
highly specific instruction that maximizes the quality of the model's next output.
Your instructions are concrete, measurable, free of filler, and anchored to the
provided data. You never invent facts and you always tell the model what NOT to do.`;

/** Loads the marketplace "prompt-master" skill, falling back to an embedded guide. */
async function loadPromptMasterGuide(): Promise<string> {
  try {
    const skill = await prisma.skill.findFirst({
      where: { name: { contains: "prompt-master" } },
    });
    if (skill?.description) return skill.description;
  } catch {
    // DB error — use fallback silently
  }
  console.warn("[market-study/prompt-master] Skill 'prompt-master' no encontrada en BD. Uso fallback embebido.");
  return FALLBACK_PROMPT_MASTER_GUIDE;
}

export interface BuildIterationPromptArgs {
  inputs: MarketStudyInputs;
  realData: RealBusinessData;
  /** Real prospect stats already rendered as a text block (optional). */
  prospectStatsBlock?: string;
  /** Free-text hint the user typed in the iteration box (optional). */
  userHint?: string;
}

/**
 * Builds the optimal iteration instruction for the study generator. The result
 * is a ready-to-use Spanish prompt that will be fed as `feedback` to
 * generateStudy, so it must read as direct instructions to the consultant model.
 */
export async function buildStudyIterationPrompt(args: BuildIterationPromptArgs): Promise<string> {
  const { inputs, realData, prospectStatsBlock, userHint } = args;
  const guide = await loadPromptMasterGuide();

  const hasData = realData.acceptedBudgetCount > 0;
  const selection = [
    `Zona: ${inputs.zone}${inputs.postalCode ? ` (CP ${inputs.postalCode})` : ""}`,
    `Radio de acción: ${inputs.radiusKm} km`,
    `Sectores objetivo: ${inputs.targetSectors.join(", ") || "no indicados"}`,
    `Zonas de expansión: ${inputs.expansionZones.join(", ") || "ninguna"}`,
    `Ticket medio: ${inputs.avgBudget ? `${inputs.avgBudget.toLocaleString("es-ES")} €` : "no indicado"}`,
    `Datos propios disponibles: ${hasData ? `sí (${realData.acceptedBudgetCount} presupuestos aceptados, ticket medio ${realData.avgAcceptedTicket.toLocaleString("es-ES")} €)` : "no (sin presupuestos aceptados)"}`,
  ].join("\n");

  const systemPrompt = `${guide}

Eres el "prompt-master" de una agencia de IA. Vas a redactar UN ÚNICO prompt de iteración en ESPAÑOL que se enviará a un consultor de estrategia (otro modelo) para mejorar un estudio de mercado ya existente.

${AGENCY_PROFILE}

El prompt que generes debe:
- Estar alineado con nuestro core de negocio (vender chatbots/IA, webs y automatización a PYMEs/negocios locales).
- Aprovechar la selección concreta del estudio (zona, radio, sectores, ticket) y, si existen, los datos reales de prospección.
- Pedir realismo y dimensionamiento con cifras (TAM/SAM/SOM, embudo de conversión con € del catálogo, niveles de confianza), no relleno genérico.
- Priorizar las oportunidades que encajan con nosotros (negocios sin web > web sin chatbot).
- Incorporar la indicación del usuario si la hay, sin contradecir lo anterior.
- Decir explícitamente qué NO hacer (no inventar competidores ni cifras propias, no contenido genérico válido para cualquier ciudad).

Responde ÚNICAMENTE con el texto del prompt de iteración (sin comillas, sin markdown, sin explicaciones). Máximo ~1800 caracteres.`;

  const userContent = `SELECCIÓN ACTUAL DEL ESTUDIO:
${selection}

${prospectStatsBlock ? `${prospectStatsBlock}\n\n` : ""}${userHint?.trim() ? `INDICACIÓN DEL USUARIO PARA ESTA ITERACIÓN:\n${userHint.trim()}\n\n` : ""}Redacta el prompt de iteración óptimo.`;

  try {
    const completion = await openai.chat.completions.create({
      model: DEFAULT_MODEL,
      max_completion_tokens: 1200,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
    if (cleaned) return cleaned.slice(0, 2000);
  } catch (err) {
    console.error("[market-study/prompt-master] Fallo al generar el prompt:", err);
  }

  // Deterministic fallback prompt derived from the selection.
  const hintLine = userHint?.trim() ? ` Atiende además esta indicación del usuario: ${userHint.trim()}.` : "";
  return `Mejora el estudio de mercado para ${inputs.zone} (radio ${inputs.radiusKm} km), centrándote en los sectores ${inputs.targetSectors.join(", ")}. Dimensiona el mercado con TAM/SAM/SOM en € y nº de negocios, construye un embudo de conversión con cifras realistas usando nuestro catálogo (implantación + mantenimiento×12) y prioriza negocios sin web o con web sin chatbot, que son nuestro cliente ideal. Usa los datos reales de prospección como cifras verificadas y etiqueta el resto como "(estimación)" o "(supuesto)" con su nivel de confianza. No inventes competidores ni cifras propias y no escribas contenido genérico que valdría para cualquier ciudad.${hintLine}`;
}
