import OpenAI from "openai";
import dotenv from "dotenv";
import { prisma } from "@/lib/db";
import { openclawAgentId } from "@/lib/openclaw/agent-id";
import {
  governChatBody,
  providerForModel,
  createGovernedClient,
  PROVIDER_BASE_URL,
} from "@/lib/llm/governance";
import { getDecryptedApiKey, failureMessage } from "@/lib/llm/credentials";
import { HttpError } from "@/lib/http";

dotenv.config();

const hasOpenAI = !!process.env.OPENAI_API_KEY;
const hasGemini = !!process.env.GEMINI_API_KEY;
const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

// Tres clientes activos a la vez: OpenAI, Gemini y Anthropic (los tres OpenAI-compat). Se rutea
// por el prefijo del modelo (gpt* → OpenAI, gemini* → Gemini, claude* → Anthropic), así el
// modelo elegido decide el proveedor y todos funcionan simultáneamente. El routing por prefijo
// vive en `providerForModel` (lib/llm/governance.ts) porque el modo BYOK usa el MISMO criterio
// para saber qué credencial del tenant buscar.
const openaiRaw = hasOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const geminiRaw = hasGemini
  ? new OpenAI({ apiKey: process.env.GEMINI_API_KEY, baseURL: PROVIDER_BASE_URL.gemini })
  : null;
// ANTHROPIC_API_KEY es OPCIONAL: sin ella los modelos claude* siguen siendo servibles en modo
// BYOK (con la clave del cliente), simplemente no hay clave de la plataforma para ellos.
const anthropicRaw = hasAnthropic
  ? new OpenAI({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: PROVIDER_BASE_URL.anthropic })
  : null;

// Cliente base exportado (embeddings y usos no-chat viven aquí): OpenAI si hay key; si no,
// Gemini; si no, Anthropic. Anthropic va último a propósito: NO sirve embeddings, así que
// elegirlo como base sólo tiene sentido cuando no hay nada más.
export const openai = (openaiRaw ?? geminiRaw ?? anthropicRaw)!;

export const DEFAULT_MODEL =
  process.env.DEFAULT_MODEL || (hasOpenAI ? "gpt-5.4-mini" : "gemini-3.5-flash");

export const STRONG_MODEL =
  process.env.STRONG_MODEL || (hasOpenAI ? "gpt-5.4" : "gemini-3.1-pro-preview");

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

// Choke point del cliente global chat.completions: RUTA cada llamada al cliente del proveedor
// del modelo (gpt* → OpenAI, gemini* → Gemini, claude* → Anthropic) — todos funcionan a la vez
// y el modelo elegido decide el proveedor. Sin tocar los ~13 call sites; cada llamada puede
// sobrescribir el effort pasando su propio `reasoning_effort` (override por agente).
//
// La GOBERNANZA de parámetros (reasoning_effort según la tabla de capacidades, y borrado de
// `temperature` en razonadores) ya NO vive aquí: es `governChatBody` en lib/llm/governance.ts.
// Se extrajo porque el modo BYOK (H2) necesita exactamente la misma regla sobre clientes
// construidos con la clave de cada tenant, y duplicarla sería garantizar que un día divergen —
// con el síntoma apareciendo como un 400 SÓLO para los clientes en BYOK. Aquí queda únicamente
// lo que es propio del cliente global: qué singleton atiende cada modelo.
//
// Se enlazan los create RAW antes de sobrescribir (el cliente base es uno de ellos → evita
// recursión). NO aplica al cliente per-agente OpenClaw ni a los clientes BYOK (instancias
// aparte, gobernadas por `createGovernedClient`).
// Guard: sin ninguna key (p.ej. deploy openclaw-only) no hay nada que parchear; `openai` es
// null y saltarse el bloque evita reventar al cargar el módulo.
if (openai) {
  const rawCreates = {
    openai: openaiRaw?.chat.completions.create.bind(openaiRaw.chat.completions),
    gemini: geminiRaw?.chat.completions.create.bind(geminiRaw.chat.completions),
    anthropic: anthropicRaw?.chat.completions.create.bind(anthropicRaw.chat.completions),
  } as const;

  // Si el proveedor del modelo no tiene key, cae al primero que sí la tenga: es el
  // comportamiento histórico (un deploy con sólo GEMINI_API_KEY servía modelos gpt*).
  const rawCreateForModel = (model?: string) =>
    rawCreates[providerForModel(model)] ??
    rawCreates.openai ??
    rawCreates.gemini ??
    rawCreates.anthropic;

  openai.chat.completions.create = ((body: any, options?: any) => {
    const create = rawCreateForModel(body?.model);
    if (!create)
      throw new Error(
        "No hay proveedor LLM configurado (falta OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY)"
      );
    return create(governChatBody(body, globalReasoningEffort), options);
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
  /**
   * Tenant dueño del agente y su modo de credenciales (H2). Ambos opcionales: un agente sin
   * tenant, o un llamador que no los pasa, se resuelven como "platform" — el comportamiento
   * histórico. Que el agente sea SERVIBLE o no lo decide `assertUsageAllowed`, no esta factory.
   */
  tenantId?: string | null;
  credentialMode?: string | null;
  /**
   * Modelo configurado del agente. Decide QUÉ credencial del tenant hay que buscar en modo
   * byok (gpt* → openai, gemini* → gemini, claude* → anthropic). Irrelevante en "platform".
   */
  model?: string | null;
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
 * Caché de instancias de cliente BYOK. La clave incluye `updatedAt` de la credencial, así que
 * cuando el cliente cambia su clave la entrada vieja deja de ser alcanzable por construcción:
 * no hay ningún paso de "acordarse de invalidar", que es exactamente el paso que falla.
 *
 * Lo que se cachea son INSTANCIAS de cliente, no credenciales: la clave se lee de la BD en cada
 * mensaje (una consulta por `@@unique`), así que revocar una credencial surte efecto en el
 * siguiente mensaje sin depender de ninguna expiración.
 */
const byokClients = new Map<string, OpenAI>();

/**
 * Resuelve el cliente OpenAI-compatible y el modelo efectivo para un agente concreto.
 * - runtime "openclaw" → cliente nuevo apuntando al gateway local; `model` = target de
 *   agente OpenClaw (ver prioridad arriba), no al `Agent.model` de la BD. IGNORA el modo de
 *   credenciales: ahí no hay clave de proveedor cloud que traer.
 * - credentialMode "platform" (o ausente) → cliente global, mismo comportamiento de siempre.
 * - credentialMode "byok" → cliente construido con la clave del tenant para el proveedor del
 *   modelo, con la MISMA gobernanza de parámetros que el global (`createGovernedClient`).
 *
 * @throws HttpError 402 en modo byok sin credencial usable. NUNCA cae al cliente de la
 *   plataforma: ese fallback silencioso convertiría el plan barato (traes tu clave) en "gasto
 *   el dinero del propietario", que es el único fallo de este cambio que cuesta dinero real.
 */
export async function getClientForAgent(
  agent: AgentRuntimeSelector
): Promise<AgentClientResolution> {
  if (agent.runtime === "openclaw") {
    const perAgentTarget = agent.agentId ? `openclaw/${openclawAgentId(agent.agentId)}` : undefined;
    return {
      client: new OpenAI({
        baseURL: process.env.OPENCLAW_BASE_URL ?? "http://localhost:18791/v1",
        apiKey: process.env.OPENCLAW_GATEWAY_TOKEN,
      }),
      model: process.env.OPENCLAW_AGENT_ID ?? perAgentTarget ?? "openclaw/default",
      isOpenclaw: true,
    };
  }

  if (agent.credentialMode === "byok" && agent.tenantId) {
    const provider = providerForModel(agent.model);
    const resolved = await getDecryptedApiKey(agent.tenantId, provider);
    if (!resolved.ok) throw new HttpError(402, failureMessage(provider, resolved.failure));

    const cacheKey = `${agent.tenantId}:${provider}:${resolved.credential.updatedAt.getTime()}`;
    let client = byokClients.get(cacheKey);
    if (!client) {
      // Purga de las entradas anteriores de ESTE tenant y proveedor. Al cambiar `updatedAt` la
      // entrada vieja ya era inalcanzable, pero seguía residente — y dentro lleva la clave que el
      // cliente acaba de rotar. Sin esto, revocar una clave la deja viva en memoria del proceso
      // hasta el siguiente despliegue, y el Map crece una entrada por rotación sin techo.
      const prefix = `${agent.tenantId}:${provider}:`;
      for (const stale of byokClients.keys()) {
        if (stale.startsWith(prefix)) byokClients.delete(stale);
      }
      client = createGovernedClient({
        provider,
        apiKey: resolved.credential.apiKey,
        defaultEffort: () => globalReasoningEffort,
      });
      byokClients.set(cacheKey, client);
    }
    return { client, isOpenclaw: false };
  }

  return { client: openai, isOpenclaw: false };
}

