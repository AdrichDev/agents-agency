import OpenAI from "openai";
import dotenv from "dotenv";
import { prisma } from "@/lib/db";

dotenv.config();

const useGemini = !!process.env.GEMINI_API_KEY;


export const openai = useGemini
  ? new OpenAI({
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    })
  : new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

export const DEFAULT_MODEL = useGemini ? "gemini-2.5-flash" : "gpt-5.4-mini";

export const STRONG_MODEL =
  process.env.STRONG_MODEL || (useGemini ? "gemini-2.5-pro" : "gpt-5.4");

// Nivel de razonamiento por defecto. Bajarlo reduce los tokens de razonamiento
// (y el gasto) de toda la familia GPT-5. Tunable por env sin tocar código:
//   OPENAI_REASONING_EFFORT=minimal  → máximo ahorro (puede bajar calidad)
//   OPENAI_REASONING_EFFORT=low      → por defecto, un notch bajo medium
//   OPENAI_REASONING_EFFORT=medium   → restaura el default del provider
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

// Effort global por defecto. Arranca con el env y se refresca desde SystemConfig
// (tabla, editable en /configuracion) vía refreshModelConfig(). Mutable a propósito.
export let globalReasoningEffort: ReasoningEffort =
  (process.env.OPENAI_REASONING_EFFORT || "low") as ReasoningEffort;

/** Relee el effort global desde la BD. Llamar al arrancar y tras guardar config. */
export async function refreshModelConfig(): Promise<void> {
  try {
    const c = await prisma.systemConfig.findUnique({ where: { id: "default" } });
    if (c?.reasoningEffort) globalReasoningEffort = c.reasoningEffort as ReasoningEffort;
  } catch {
    /* sin BD aún: se mantiene el valor del env */
  }
}

// Choke point: inyecta reasoning_effort por defecto en las llamadas
// chat.completions, sin tocar los ~13 call sites. Cada call puede sobrescribirlo
// pasando su propio reasoning_effort (override por agente). Solo aplica a modelos
// razonadores gpt-5*: los gpt-4* (algunos agentes) y el endpoint compatible de
// Gemini rechazan el parámetro con error 400.
if (!useGemini) {
  const rawCreate = openai.chat.completions.create.bind(openai.chat.completions);
  openai.chat.completions.create = ((body: any, options?: any) => {
    // reasoning_effort solo en gpt-5* y SIN function tools: OpenAI rechaza
    // reasoning_effort + tools en /v1/chat/completions (400). Los generadores
    // (landing, market-study) no usan tools → conservan el ahorro de coste.
    const isReasoning =
      typeof body?.model === "string" && body.model.startsWith("gpt-5") && !body.tools;
    return rawCreate(
      isReasoning ? { reasoning_effort: globalReasoningEffort, ...body } : body,
      options,
    );
  }) as typeof openai.chat.completions.create;
}

