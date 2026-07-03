import OpenAI from "openai";
import dotenv from "dotenv";
import { prisma } from "@/lib/db";
import { openclawAgentId } from "@/lib/openclaw/agent-id";

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
// Valores soportados por gpt-5.4 (confirmados por la API): none/low/medium/high/xhigh.
// 'minimal' (legado) se acepta en lectura pero se remapea a 'low' al inyectar.
type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "minimal";

// Effort global por defecto. Arranca con el env y se refresca desde SystemConfig
// (tabla, editable en /configuracion) vía refreshModelConfig(). Mutable a propósito.
let globalReasoningEffort: ReasoningEffort =
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
    // Los gpt-5.4 ya no aceptan 'minimal' (válidos: none/low/medium/high/xhigh).
    // Remapeamos 'minimal'→'low' para no romper con configs/env antiguos.
    const effort = globalReasoningEffort === "minimal" ? "low" : globalReasoningEffort;
    return rawCreate(
      isReasoning ? { reasoning_effort: effort, ...body } : body,
      options,
    );
  }) as typeof openai.chat.completions.create;
}

// ---------------------------------------------------------------------------
// Per-agent client factory (F1 — openspec/changes/aa-openclaw-brain).
// runtime="openclaw" agents se ejecutan contra el gateway local de OpenClaw
// en vez del proveedor cloud de arriba. El `model` de la llamada es un TARGET
// de agente OpenClaw (workspace/persona/modelo Ollama viven en la config
// propia de OpenClaw), NO un id de modelo Ollama crudo — ver spike.md §2/§3.
// El cliente que devuelve para runtime="openclaw" es una instancia NUEVA,
// sin el choke-point de reasoning_effort de arriba (ese parámetro no aplica
// a este proveedor y nunca se inyecta).
//
// Routing per-agent (cierre del gap F1↔F2, aprobado por el orquestador
// 03/07/2026): F2 (lib/openclaw/provision.ts) aprovisiona una entrada
// agents.list[] POR AGENTE con id openclawAgentId(agent.id) = "aa-<agentId>".
// Este factory debe apuntar el chat a ESE mismo target, no a un agente
// compartido fijo. Prioridad del `model` efectivo:
//   1. OPENCLAW_AGENT_ID (env) — override GLOBAL opcional, gana siempre si
//      está definido; útil para el gateway actual de un solo agente/demo.
//   2. `openclaw/${openclawAgentId(agent.id)}` — target per-agente derivado,
//      coincide con lo que F2 provisiona en agents.list[].
//   3. "openclaw/default" — fallback final si no hay agentId disponible
//      (llamador legado que no lo pasa).
// ---------------------------------------------------------------------------

/** Subconjunto del modelo Agent que necesita la factory (retrocompatible con filas sin migrar). */
export interface AgentRuntimeSelector {
  runtime?: string | null;
  /** Id de Agent (agents-agency) — deriva el target per-agente openclaw/aa-<agentId>. Opcional (retrocompatible). */
  agentId?: string | null;
}

export interface AgentClientResolution {
  /** Cliente OpenAI-compatible a usar para este agente. */
  client: OpenAI;
  /** Si está presente, sustituye SIEMPRE al `model` configurado en el agente (caso openclaw). */
  model?: string;
  /** true si el cliente apunta al gateway OpenClaw (para decidir extras como `user`). */
  isOpenclaw: boolean;
}

/**
 * Resuelve el cliente OpenAI-compatible y el modelo efectivo para un agente concreto.
 * - runtime ausente o "openai" (retrocompatible, filas sin migrar) → cliente global sin
 *   cambios, mismo comportamiento de siempre.
 * - runtime "openclaw" → cliente nuevo apuntando al gateway local; `model` = target de
 *   agente OpenClaw (ver prioridad arriba), no al `Agent.model` de la BD.
 */
export function getClientForAgent(agent: AgentRuntimeSelector): AgentClientResolution {
  if (agent.runtime === "openclaw") {
    const perAgentTarget = agent.agentId ? `openclaw/${openclawAgentId(agent.agentId)}` : undefined;
    return {
      client: new OpenAI({
        baseURL: process.env.OPENCLAW_BASE_URL ?? "http://localhost:18790/v1",
        apiKey: process.env.OPENCLAW_GATEWAY_TOKEN,
      }),
      model: process.env.OPENCLAW_AGENT_ID ?? perAgentTarget ?? "openclaw/default",
      isOpenclaw: true,
    };
  }
  return { client: openai, isOpenclaw: false };
}

