import type { ReasoningEffort } from "openai/resources/shared";
import { prisma } from "@/lib/db";
import { getClientForAgent } from "@/lib/openai";
import { deductTokens } from "@/lib/token-metering";
import { getConversationMetadata, mergeConversationMetadata } from "@/lib/agent/handoff";
import { logger } from "@/lib/logger";

/**
 * T8.6 (aa-agentes-economia-tokens) — `leadIntent` sin pagar una vuelta del bucle agéntico.
 *
 * ANTES: una tool, `record_lead_intent`. El modelo la llamaba cuando detectaba intención de compra,
 * y como su `output` es un eco de su propio argumento (`{ recorded, intent }`), el turno terminaba
 * costando DOS llamadas al LLM: la segunda sólo servía para reenviar el prompt completo y escribir
 * la respuesta. Medido en la BD de producción: 2 de los 7 últimos mensajes de AiAs.
 *
 * Se intentó cerrar el turno en una vuelta reutilizando el `content` del mismo mensaje. Medido
 * contra la API: `gpt-5.4-mini` devuelve `content: null` con `finish_reason: "tool_calls"` en 3 de
 * 3 intentos, incluso ordenándole explícitamente responder en el mismo turno. No había texto que
 * reutilizar, así que la tool tenía que desaparecer.
 *
 * AHORA: el dato se deriva una vez por CONVERSACIÓN CON LEAD, no por mensaje con intención. Los
 * leads son una fracción de los mensajes, la llamada es de ~300 tokens frente a los ~1100 de una
 * vuelta del bucle, y se hace con el historial delante en vez de con un turno aislado.
 *
 * Invariantes:
 *  - **Best-effort**: nada de lo que pase aquí puede romper el chat. Se invoca sin esperar (`void`
 *    + `.catch`) porque el visitante ya tiene su respuesta; un fallo sólo significa columna vacía.
 *  - **Sólo con lead**: sin Lead en la conversación no hay ninguna columna que rellenar, así que no
 *    se gasta nada. Cubre los cuatro sitios que crean leads (flujo de captación, handoff,
 *    `calificar_lead` y `crear_lead` del backend) sin acoplarse a ninguno.
 *  - **Idempotente**: si `leadIntent` ya está en la metadata, no se vuelve a pagar. El lead se
 *    actualiza varias veces por conversación; esto se paga una.
 *  - **Contabilizado**: consume tokens del tenant, así que pasa por `deductTokens` con
 *    `operacion: "lead_intent"`. Un consumo invisible rompería H1 (metering fail-closed).
 *  - **Respeta BYOK**: usa `getClientForAgent` con el `credentialMode` que ya resolvió el gate de
 *    uso, para que un tenant con su propia clave no se sirva con la de la plataforma.
 */

/** Respuesta convenida del modelo cuando no hay ninguna intención clara. */
const SIN_INTENCION = "NINGUNA";

/** Mensajes de cola que se le pasan al modelo. Suficiente contexto, coste acotado. */
const MAX_MESSAGES = 10;

/**
 * Tope de tokens de salida.
 *
 * Estaba en 32 —el tamaño de la etiqueta— y eso era un error MEDIDO en producción: en un modelo
 * razonador `max_completion_tokens` incluye los tokens de razonamiento, y `governChatBody` inyecta
 * el `reasoning_effort` global (`low` por defecto) a todo body sin `tools`. Resultado real contra la
 * API, dos de dos: `reasoning_tokens: 32`, `finish_reason: "length"`, `content: ""`. Se pagaban 159
 * tokens por conversación y no se persistía nada.
 *
 * Se pide `none` (ver `REASONING_EFFORT`) y aun así el tope se deja holgado: si un modelo del
 * catálogo no admite `none`, la gobernanza cae a SU default y el razonamiento vuelve a consumir
 * presupuesto. Un tope alto no cuesta nada —se factura lo generado, no el tope— y es lo único que
 * evita que la misma clase de fallo vuelva con otro modelo. La etiqueta se acota con
 * `MAX_INTENT_CHARS`, no con el tope.
 */
const MAX_OUTPUT_TOKENS = 256;

/**
 * Sin razonamiento: extraer una etiqueta de una transcripción que ya está delante no lo necesita, y
 * cada token de razonamiento es cupo del tenant. `gpt-5.4-mini` admite `none`; para un modelo que no
 * lo admita, `resolveEffort` cae a su default (de ahí el tope holgado de arriba).
 *
 * El cast: el union `ReasoningEffort` del SDK 4.x es `'low' | 'medium' | 'high'` y va por detrás de
 * la API, que en los `gpt-5*` acepta además `none` y `xhigh`. La fuente de verdad es la tabla de
 * `model-capabilities.ts` —verificada por sonda contra la API real— y quien valida el nivel contra
 * ella antes de que el body salga a la red es `governChatBody`, no el tipo del SDK. Es el mismo
 * desajuste que `llm/governance.ts` ya sortea con un `patched: any`.
 */
const REASONING_EFFORT = "none" as unknown as ReasoningEffort;

/** Tope de la etiqueta persistida. La columna del panel de leads no pinta más. */
const MAX_INTENT_CHARS = 120;

export interface InferLeadIntentParams {
  agentId: string;
  conversationId: string;
  /** Modelo configurado del agente (decide qué credencial buscar en modo byok). */
  model: string;
  runtime?: string | null;
  /**
   * Tenant al que imputar y modo de credenciales, tal como los resolvió `assertUsageAllowed` en
   * el mismo turno. No se re-leen aquí: si el gate autorizó con un modo, éste es ése.
   */
  tenantId: string | null;
  credentialMode?: string | null;
  /** Prueba de consola: no imputa cupo, igual que el resto del turno. */
  isTest?: boolean;
}

export async function inferLeadIntent(params: InferLeadIntentParams): Promise<void> {
  const { agentId, conversationId, model, runtime, tenantId, credentialMode, isTest } = params;
  try {
    const meta = await getConversationMetadata(conversationId);
    if (typeof meta.leadIntent === "string" && meta.leadIntent) return;

    const lead = await prisma.lead.findUnique({
      where: { conversationId },
      select: { id: true },
    });
    if (!lead) return;

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: MAX_MESSAGES,
      select: { role: true, content: true },
    });
    // Sin nada que el visitante haya dicho no hay intención que extraer, y la llamada sería un
    // gasto seguro con resultado vacío garantizado.
    if (!messages.some((m) => m.role === "user")) return;

    const transcript = [...messages]
      .reverse()
      .map((m) => `${m.role === "user" ? "Visitante" : "Agente"}: ${m.content}`)
      .join("\n");

    const { client, model: resolvedModel, isOpenclaw } = await getClientForAgent({
      agentId,
      model,
      runtime,
      credentialMode,
      tenantId,
    });
    // En runtime openclaw el target lo decide el gateway; en el resto manda el modelo configurado.
    const effectiveModel = (isOpenclaw ? resolvedModel : model) || model;

    const completion = await client.chat.completions.create({
      model: effectiveModel,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      // Lo consume `governChatBody`, que valida el nivel contra la tabla de capacidades del modelo.
      reasoning_effort: REASONING_EFFORT,
      messages: [
        {
          role: "system",
          content:
            "Extrae el producto, servicio, plan o categoría concreta que interesa al visitante. " +
            "Responde SOLO con esa etiqueta, máximo 6 palabras, sin comillas. " +
            `Si no hay ninguna clara, responde exactamente ${SIN_INTENCION}.`,
        },
        { role: "user", content: transcript },
      ],
    });

    const tokens = completion.usage?.total_tokens ?? 0;
    // El metering va antes de decidir si el resultado sirve: los tokens se gastaron igual, y no
    // registrarlos por haber salido "NINGUNA" sería consumo invisible.
    if (!isTest && tenantId && tokens > 0) {
      await deductTokens(
        tenantId,
        agentId,
        conversationId,
        tokens,
        effectiveModel,
        "lead_intent",
        credentialMode ?? "platform"
      ).catch((e) => logger.error({ err: e }, "[lead-intent] metering falló"));
    }

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw || raw.toUpperCase().startsWith(SIN_INTENCION)) return;

    await mergeConversationMetadata(conversationId, { leadIntent: raw.slice(0, MAX_INTENT_CHARS) });
  } catch (e) {
    // Best-effort de verdad: el chat ya respondió. Un fallo aquí sólo significa columna vacía.
    logger.error({ err: e, agentId, conversationId }, "[lead-intent] inferencia falló");
  }
}
