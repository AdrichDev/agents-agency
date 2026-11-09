/**
 * S5 (odd/tasks/model-catalog.md) — adaptador `chat.completions` → `/v1/responses`.
 *
 * Decisión de producto (L4 del change): "Todos por Responses API" para el proveedor OpenAI. El
 * bucle del agente (`agent/responses-loop.ts`) y `lead-intent` ya eligen endpoint por modelo; las
 * 13 llamadas sueltas (landing, estudio de mercado, scraper de skills, `/api/ai`) siguen llamando
 * a `openai.chat.completions.create` y NO se tocan. Lo que cambia es el punto único de cliente:
 *   - el singleton de `lib/openai.ts` (modo plataforma), y
 *   - `createGovernedClient` (`llm/governance.ts`, modo BYOK),
 * que traducen ahí mismo la petición y la respuesta. Así ninguna de esas llamadas queda fuera por
 * olvido de un call-site, que es exactamente el modo de fallo que S5 quiere cerrar.
 *
 * Alcance deliberado: es un adaptador de UNA vuelta. Traduce petición y respuesta y no mantiene
 * hilo (`store: false`), porque ninguno de los llamadores de hoy encadena tool calls por esta vía
 * (comprobado: los 13 mandan sólo mensajes). Traduce igualmente herramientas y mensajes `tool`
 * para que un llamador con tool calling no reciba un cuerpo mal formado; para un bucle con hilo de
 * verdad ya está `agent/responses-loop.ts`, que reenvía los items de salida.
 *
 * La traducción es PURA (no lee env, no toca red, no construye clientes): el formato sólo se puede
 * comprobar mirando lo que acabó llegando al proveedor, así que se prueba por tabla.
 */
import { modelSupportsEffort, resolveEffort } from "@/lib/model-capabilities";
import { parseResponsesTurn, toResponsesTools, type ChatTool } from "@/lib/agent/responses-loop";

/** Resultado con la MISMA forma que un `ChatCompletion` del SDK, que es lo que el llamador lee. */
export interface ChatCompletionLike {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter";
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /**
     * Sólo aparece si el proveedor informa de `cached_tokens`. La ausencia se conserva a
     * propósito: los llamadores distinguen "no informó" (`?? null`) de "no acertó" (0), igual
     * que el desglose de `AgentReply` (T8.2).
     */
    prompt_tokens_details?: { cached_tokens: number };
  };
}

/** Respuesta de `/v1/responses` en lo que este adaptador necesita leer. */
interface ResponsesResponseLike {
  id?: string;
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: unknown[];
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number } | null;
  } | null;
}

export type ResponsesCreateLike = (body: Record<string, unknown>, options?: unknown) => Promise<ResponsesResponseLike>;

/**
 * `responses.create` del cliente, enlazado, o `null` si el cliente no lo expone.
 *
 * `null` y no un lanzamiento: los dos llamadores tienen una respuesta correcta a la ausencia. El
 * cliente global mantiene el fallback histórico a chat cuando no hay clave de OpenAI (un deploy
 * con sólo GEMINI_API_KEY servía modelos `gpt*` por la capa compatible); el cliente BYOK de OpenAI
 * siempre es el SDK real, que sí lo expone.
 */
export function responsesCreateOf(client: unknown): ResponsesCreateLike | null {
  const holder = (client as { responses?: { create?: unknown } } | null)?.responses;
  const create = holder?.create;
  return typeof create === "function" ? (create.bind(holder) as ResponsesCreateLike) : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Texto de un `content` de chat (cadena o lista de partes). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof (part as { text?: unknown })?.text === "string" ? (part as { text: string }).text : ""))
      .join("");
  }
  return "";
}

/**
 * Mensajes de `chat.completions` → items de entrada de `/v1/responses`.
 *
 * Los roles normales (`system`/`user`/`assistant`) viajan tal cual: son `EasyInputMessage` con la
 * misma forma `{role, content}`, así que el prefijo estable no cambia. Un turno del asistente con
 * `tool_calls` se abre en un `function_call` por llamada, y un mensaje `role: "tool"` se convierte
 * en su `function_call_output` con el mismo `call_id` — el formato que la API espera para cerrar
 * el par.
 */
export function toResponsesInputItems(messages: unknown[]): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];

  for (const raw of messages) {
    const m = raw as {
      role?: string;
      content?: unknown;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
      tool_call_id?: string;
    } | null;
    if (!m || typeof m !== "object") continue;

    if (m.role === "tool") {
      items.push({
        type: "function_call_output",
        call_id: m.tool_call_id ?? "",
        output: textOf(m.content),
      });
      continue;
    }

    const content = textOf(m.content);

    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      if (content) items.push({ role: "assistant", content });
      for (const tc of m.tool_calls) {
        items.push({
          type: "function_call",
          call_id: tc?.id ?? "",
          name: tc?.function?.name ?? "",
          arguments: tc?.function?.arguments ?? "",
        });
      }
      continue;
    }

    items.push({ role: m.role, content });
  }

  return items;
}

/**
 * `response_format` de chat → `text.format` de Responses.
 *
 * `json_object` y `json_schema` son los dos formatos que el SDK declara en ambas APIs. Un tipo
 * desconocido se descarta en vez de inventarse: ninguno de los llamadores de hoy usa otro, y
 * mandar un formato mal formado es peor que no mandar ninguno.
 */
function toResponsesFormat(responseFormat: unknown): Record<string, unknown> | undefined {
  const format = responseFormat as { type?: string; json_schema?: Record<string, any> } | null;
  if (!format || typeof format !== "object") return undefined;
  if (format.type === "json_object") return { type: "json_object" };
  if (format.type === "json_schema") {
    const js = format.json_schema ?? {};
    return {
      type: "json_schema",
      name: typeof js.name === "string" ? js.name : "output",
      schema: typeof js.schema === "object" && js.schema !== null ? js.schema : {},
      ...(typeof js.description === "string" ? { description: js.description } : {}),
      ...(typeof js.strict === "boolean" ? { strict: js.strict } : {}),
    };
  }
  return undefined;
}

/**
 * Cuerpo de `chat.completions` → cuerpo de `POST /v1/responses`.
 *
 * Reglas, y el motivo de cada una (son las mismas que `governChatBody` aplica en la ruta chat, con
 * el mismo `resolveEffort`, para que el effort no pueda divergir entre endpoints):
 *  - `reasoning_effort` → `reasoning.effort`, validado contra el catálogo del modelo. Un nivel que
 *    el modelo no acepta cae a su default; un modelo sin efforts no manda bloque. Aquí SÍ se manda
 *    effort junto a `tools` (es la diferencia real entre las dos APIs), aunque hoy ningún llamador
 *    de esta vía use herramientas.
 *  - `temperature` sólo en modelos NO razonadores: los razonadores únicamente admiten el default.
 *  - `max_completion_tokens`/`max_tokens` → `max_output_tokens`. Si el body no trae tope NO se
 *    inventa uno: los estudios de mercado largos se generarían truncados.
 *  - `response_format` → `text.format`.
 *  - El resto de campos de chat (`n`, `stop`, `seed`, `stream`, penalizaciones…) no se reenvía: el
 *    adaptador es de una vuelta y no puede honrar streaming.
 */
export function toResponsesRequest(
  chatBody: Record<string, any>,
  defaultEffort?: string | null
): Record<string, unknown> {
  const body = chatBody ?? {};
  const model = typeof body.model === "string" ? body.model : "";
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) && body.tools.length > 0 ? toResponsesTools(body.tools as ChatTool[]) : null;
  const maxOutput =
    asNumber(body.max_completion_tokens) ?? asNumber(body.max_tokens);
  const effort = resolveEffort(model, (body.reasoning_effort ?? defaultEffort) as any);
  const format = toResponsesFormat(body.response_format);
  const temperature = modelSupportsEffort(model) ? undefined : asNumber(body.temperature);
  const topP = asNumber(body.top_p);

  return {
    model,
    // Sin estado: el adaptador no reenvía items de salida, así que no puede depender de un hilo
    // guardado en el proveedor.
    store: false,
    input: toResponsesInputItems(messages),
    ...(tools ? { tools } : {}),
    ...(maxOutput !== undefined ? { max_output_tokens: maxOutput } : {}),
    ...(format ? { text: { format } } : {}),
    ...(effort ? { reasoning: { effort } } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
  };
}

/**
 * `Response` → objeto con forma de `ChatCompletion`.
 *
 * El texto y las llamadas a herramienta se leen con `parseResponsesTurn` (el mismo lector que usa
 * el bucle del agente): una sola definición de "dónde está el texto y dónde las llamadas".
 * `finish_reason` se reconstruye porque los llamadores existen para leerlo: `tool_calls` si hay
 * llamadas (así lo haría chat), `length` si el proveedor cortó por tope de tokens, `stop` si no.
 */
export function toChatCompletion(response: ResponsesResponseLike, requestModel: string): ChatCompletionLike {
  const parsed = parseResponsesTurn(response ?? {});
  const toolCalls = parsed.toolCalls.map((tc) => ({
    id: tc.callId,
    type: "function" as const,
    function: { name: tc.name, arguments: tc.arguments },
  }));

  const incomplete = response?.incomplete_details?.reason;
  const finish_reason: ChatCompletionLike["choices"][number]["finish_reason"] = toolCalls.length
    ? "tool_calls"
    : incomplete === "max_output_tokens"
      ? "length"
      : incomplete === "content_filter"
        ? "content_filter"
        : "stop";

  const usageIn = response?.usage ?? null;
  const prompt = usageIn?.input_tokens ?? 0;
  const completion = usageIn?.output_tokens ?? 0;
  const cached = usageIn?.input_tokens_details?.cached_tokens;

  return {
    id: typeof response?.id === "string" ? response.id : "resp_compat",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: typeof response?.model === "string" ? response.model : requestModel,
    choices: [
      {
        index: 0,
        finish_reason,
        message: {
          role: "assistant",
          content: parsed.text ? parsed.text : null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: usageIn?.total_tokens ?? prompt + completion,
      ...(typeof cached === "number" ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
    },
  };
}

/**
 * Hace la llamada por `/v1/responses` y devuelve el resultado con forma de `ChatCompletion`.
 *
 * `options` (señal de aborto, timeout, cabeceras por petición) se reenvía tal cual: es la misma
 * petición del llamador, sólo cambia el endpoint.
 */
export async function createChatCompletionViaResponses(params: {
  create: ResponsesCreateLike;
  body: Record<string, any>;
  defaultEffort?: string | null;
  options?: unknown;
}): Promise<ChatCompletionLike> {
  const { create, body, defaultEffort, options } = params;
  const response = await create(toResponsesRequest(body, defaultEffort), options);
  return toChatCompletion(response, typeof body?.model === "string" ? body.model : "");
}
