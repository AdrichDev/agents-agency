// S1–S4 (odd/tasks/responses-api-migration.md) — ruta `/v1/responses` del bucle agéntico.
//
// Por qué existe esta ruta: OpenAI retiró `gpt-4.1-nano` y, al pasar los agentes a
// `gpt-5.6-luna`, `/v1/chat/completions` rechaza las function tools en cuanto el modelo razona
// ("Function tools with reasoning_effort are not supported for gpt-5.6-luna. To use function
// tools, use /v1/responses"). Falla también con `none` y sin effort, así que no hay parámetro que
// lo arregle: hay que cambiar de endpoint.
//
// Lo que cambia y lo que NO:
//  - Cambia el formato de la petición y el del hilo: sin estado (`store: false`), razonamiento
//    cifrado en la respuesta (`include: ["reasoning.encrypted_content"]`) y reenvío de TODOS los
//    items de salida (razonamiento + `function_call`) seguidos de un `function_call_output` con
//    su `call_id`. Verificado contra la API real (L6 del change): un bucle de herramienta de dos
//    iteraciones funciona con esta forma y no sin el razonamiento cifrado.
//  - NO cambia el contrato de salida (`AgentReply`): eso lo fija el bucle de `engine.ts`, que es
//    compartido. Aquí sólo se traduce de/hacia el formato de cada API a través de `TurnDriver`,
//    para que las guardas (`guardFinalReply`, `enforceCitations`, `frameUntrusted`), el recorte a
//    12000, `MAX_ITERATIONS` y el metering sigan viviendo en UN solo sitio.
//
// Todo lo de este módulo salvo `createResponsesDriver` es puro: se prueba por tabla de entradas y
// salidas, que es la única forma de fijar un formato que de otro modo sólo se ve mirando qué
// acabó llegando al proveedor.

import { HttpError } from "@/lib/http";
import { resolveEffort } from "@/lib/model-capabilities";

/** Tope de tokens de salida: el mismo que la ruta chat.completions (S1). */
export const RESPONSES_MAX_OUTPUT_TOKENS = 2048;

/** Herramienta tal como la construye el motor para `chat.completions`. */
export interface ChatTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/**
 * Herramienta en el formato PLANO de `/v1/responses` (S1).
 *
 * `strict: false` es deliberado: los schemas del catálogo de tools declaran `properties` sin
 * `additionalProperties: false` y dejan claves opcionales, y con `strict: true` OpenAI rechaza el
 * schema en vez de la llamada. Se pide explícito, no por defecto.
 */
export interface ResponsesTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: false;
}

/** Mensaje de entrada de `/v1/responses` (sistema, historial o usuario). */
export interface ResponsesInputMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Uso acumulado del turno, en las mismas claves que `usageBreakdown` del `AgentReply`. */
export interface ResponsesUsageTotals {
  total: number;
  prompt: number;
  cached: number | null;
}

/** Llamada a herramienta ya normalizada (misma forma que la de `chat.completions`). */
export interface TurnToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Resultado de UNA iteración del bucle, independiente del endpoint que la produjo. */
export interface TurnStep {
  text: string;
  toolCalls: TurnToolCall[];
  usage: { total: number; prompt: number; cached: number | null };
}

/**
 * Conductor de las llamadas del bucle (una por iteración).
 *
 * `call()` hace la petición y devuelve el paso ya traducido; `pushToolResult()` deja el resultado
 * de una herramienta listo para la siguiente llamada. El bucle de `engine.ts` no sabe —ni debe
 * saber— por qué endpoint pasó: así las dos rutas comparten guardas, tope de iteraciones y texto
 * de agotamiento, que es exactamente lo que S2 exige que no divergan.
 */
export interface TurnDriver {
  call(): Promise<TurnStep>;
  pushToolResult(call: TurnToolCall, framedOutput: string): void;
}

/** Traduce las herramientas del motor al formato plano de `/v1/responses`. */
export function toResponsesTools(tools: ChatTool[]): ResponsesTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
    strict: false as const,
  }));
}

/**
 * Traduce los mensajes del turno (sistema + historial + bloques variables + usuario) a items de
 * entrada. Son `EasyInputMessage` con la misma forma `{role, content}`, así que el prefijo estable
 * que el proveedor cachea viaja idéntico y en el mismo orden (S2).
 */
export function toResponsesInput(
  messages: Array<{ role: string; content: string }>
): ResponsesInputMessage[] {
  return messages.map((m) => ({
    role: m.role as ResponsesInputMessage["role"],
    content: m.content,
  }));
}

export interface ParsedResponsesTurn {
  text: string;
  toolCalls: Array<{ callId: string; name: string; arguments: string }>;
}

/**
 * Lee un `Response` de `/v1/responses`: el texto final de los items `message`/`output_text` y las
 * llamadas a herramienta con su `call_id` (que es lo que necesita `function_call_output`).
 *
 * `output_text` del SDK queda como respaldo: es el agregado que ya calcula el cliente, y sirve
 * para un proveedor que no devuelva los items item a item.
 */
export function parseResponsesTurn(response: { output?: unknown[]; output_text?: string }): ParsedResponsesTurn {
  const output = Array.isArray(response?.output) ? response.output : [];
  const toolCalls: ParsedResponsesTurn["toolCalls"] = [];
  let text = "";

  for (const raw of output) {
    const item = raw as {
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
      name?: string;
      call_id?: string;
      arguments?: string;
    } | null;
    if (item?.type === "function_call") {
      toolCalls.push({
        callId: item.call_id ?? "",
        name: item.name ?? "",
        arguments: item.arguments ?? "",
      });
      continue;
    }
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type === "output_text" && typeof part.text === "string") text += part.text;
      }
    }
  }

  if (!text && typeof response?.output_text === "string") text = response.output_text;
  return { text, toolCalls };
}

export interface ResponsesUsageLike {
  total_tokens?: number;
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number } | null;
}

/**
 * Acumula el uso de una respuesta al desglose del turno (S2).
 *
 * `cached` sigue la regla de T8.2: sólo se pondera si el proveedor informa del campo, así que un
 * proveedor que nunca lo manda deja `null` (no informó) y no un `0` que parecería "no acertó".
 */
export function accumulateResponsesUsage(
  previous: ResponsesUsageTotals,
  usage?: ResponsesUsageLike | null
): ResponsesUsageTotals {
  const cached = usage?.input_tokens_details?.cached_tokens;
  return {
    total: previous.total + (usage?.total_tokens ?? 0),
    prompt: previous.prompt + (usage?.input_tokens ?? 0),
    cached: typeof cached === "number" ? (previous.cached ?? 0) + cached : previous.cached,
  };
}

export interface ResponsesBodyParams {
  model: string;
  input: unknown[];
  tools?: ResponsesTool[];
  maxOutputTokens?: number;
  /** Nivel de razonamiento ya resuelto contra el catálogo del modelo, o null para no mandarlo. */
  effort?: string | null;
}

/**
 * Cuerpo de `POST /v1/responses` para una iteración.
 *
 * Sin `temperature` a propósito: los modelos de esta ruta son razonadores y sólo admiten el
 * default (S3), igual que en la ruta chat. Sin `previous_response_id` a propósito: el hilo se
 * reenvía entero porque `store: false` (S1).
 */
export function buildResponsesBody(params: ResponsesBodyParams) {
  const { model, input, tools, maxOutputTokens = RESPONSES_MAX_OUTPUT_TOKENS, effort } = params;
  return {
    model,
    store: false,
    include: ["reasoning.encrypted_content"] as Array<"reasoning.encrypted_content">,
    max_output_tokens: maxOutputTokens,
    input,
    ...(tools && tools.length ? { tools } : {}),
    ...(effort ? { reasoning: { effort } } : {}),
  };
}

type ResponsesCreate = (
  body: ReturnType<typeof buildResponsesBody>
) => Promise<{ output?: unknown[]; output_text?: string; usage?: ResponsesUsageLike }>;

/**
 * S4 — resuelve `responses.create` del cliente que ya resolvió `getClientForAgent` (plataforma o
 * BYOK) y falla CERRADO si no lo expone.
 *
 * Fail-closed y no fallback: un cliente OpenAI-compatible de otro proveedor puede tener la
 * propiedad `responses` y no el endpoint, pero nunca se cae a otro proveedor ni a
 * `chat.completions` con el mismo modelo — con luna ese camino es justo el que devuelve 400
 * (herramientas) o texto vacío (sin herramientas). El error dice qué revisar.
 */
export function responsesCreateOrThrow(client: unknown, model: string): ResponsesCreate {
  const holder = (client as { responses?: { create?: ResponsesCreate } } | null)?.responses;
  const create = holder?.create;
  if (typeof create !== "function") {
    throw new HttpError(
      503,
      `El modelo ${model} sólo está disponible por la Responses API de OpenAI, pero el cliente LLM ` +
        `resuelto para este agente no la expone. Revisa la credencial del proveedor (modo BYOK) o ` +
        `elige otro modelo.`,
      "LLM_RESPONSES_UNSUPPORTED"
    );
  }
  return create.bind(holder) as ResponsesCreate;
}

export interface ResponsesDriverParams {
  /** Cliente resuelto por `getClientForAgent` (se comprueba en `responsesCreateOrThrow`). */
  client: unknown;
  model: string;
  tools: ChatTool[];
  /** Items de entrada iniciales: sistema + historial + bloques variables + mensaje del usuario. */
  input: Array<{ role: string; content: string }>;
  maxOutputTokens?: number;
}

/**
 * Conductor de la ruta Responses.
 *
 * El hilo vive en `items` y se reenvía entero en cada iteración: primero los mensajes iniciales,
 * después los items de salida de cada respuesta (razonamiento cifrado + `function_call`) y, justo
 * detrás de cada `function_call`, su `function_call_output` con el mismo `call_id`. Es la forma
 * verificada contra la API (L6); el razonamiento cifrado no es opcional, sin él la segunda
 * iteración pierde el hilo de la herramienta.
 */
export function createResponsesDriver(params: ResponsesDriverParams): TurnDriver {
  const { client, model, tools, input, maxOutputTokens } = params;
  const create = responsesCreateOrThrow(client, model);
  const responsesTools = toResponsesTools(tools);
  // S3: el effort sale del catálogo del modelo (para luna, `low`: medido ~2 s frente a ~4,6 s
  // con `none`, L6). Un modelo sin esfuerzos declarados no manda el bloque.
  const effort = resolveEffort(model);
  const items: unknown[] = toResponsesInput(input);

  return {
    async call() {
      const response = await create(
        buildResponsesBody({ model, input: items, tools: responsesTools, effort, maxOutputTokens })
      );

      // S1: los items de salida se reenvían TAL CUAL (incluido el razonamiento cifrado). Se
      // empujan antes de devolver el paso, así el `function_call_output` que añada el bucle queda
      // justo detrás de su `function_call`.
      if (Array.isArray(response?.output)) items.push(...response.output);

      const parsed = parseResponsesTurn(response);
      return {
        text: parsed.text,
        toolCalls: parsed.toolCalls.map((tc) => ({
          id: tc.callId,
          name: tc.name,
          arguments: tc.arguments,
        })),
        usage: accumulateResponsesUsage({ total: 0, prompt: 0, cached: null }, response?.usage),
      };
    },
    pushToolResult(call, framedOutput) {
      items.push({ type: "function_call_output", call_id: call.id, output: framedOutput });
    },
  };
}

/**
 * S6 — una llamada SIN herramientas por la Responses API, para usos auxiliares del motor
 * (`lead-intent.ts`).
 *
 * Con `gpt-5.6-luna` en `chat.completions` el resultado medido fue texto vacío: el razonamiento se
 * come el tope de tokens y `finish_reason: "length"`. Se usa el mismo cuerpo que el bucle (sin
 * estado y con effort del catálogo) y un tope holgado que el llamador decide.
 */
export async function responsesPlainText(params: {
  client: unknown;
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
}): Promise<{ text: string; tokens: number }> {
  const { client, model, system, user, maxOutputTokens } = params;
  const create = responsesCreateOrThrow(client, model);
  const response = await create(
    buildResponsesBody({
      model,
      input: toResponsesInput([
        { role: "system", content: system },
        { role: "user", content: user },
      ]),
      effort: resolveEffort(model),
      maxOutputTokens,
    })
  );
  return {
    text: parseResponsesTurn(response).text,
    tokens: response?.usage?.total_tokens ?? 0,
  };
}
