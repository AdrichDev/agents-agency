// S5 (odd/tasks/model-catalog.md) — adaptador `chat.completions` → `/v1/responses`.
//
// Decisión de producto: "Todos por Responses API" para el proveedor OpenAI. Las 13 llamadas
// sueltas (landing, estudio de mercado, scraper, `/api/ai`) NO se tocan: siguen llamando a
// `openai.chat.completions.create` y es en el punto único de cliente donde este adaptador traduce.
// Aquí se fija la TRADUCCIÓN en las dos direcciones, que es lo que de otro modo sólo se puede
// comprobar mirando qué acabó llegando al proveedor:
//   - petición: mensajes/herramientas/tope/formato/effort de chat → cuerpo de `/v1/responses`;
//   - respuesta: `Response` → el mismo objeto con forma de `ChatCompletion` que el llamador ya
//     espera (`choices[0].message.content`, `usage.total_tokens`), para que ninguna de esas 13
//     llamadas tenga que cambiar una línea.
//
// `store: false` no es cosmético: el adaptador es de UNA vuelta (no reenvía items de salida), así
// que no puede depender de un hilo guardado en el proveedor. Los 13 llamadores de hoy sólo mandan
// mensajes (ninguno encadena tool calls por esta vía); para un bucle con hilo ya está
// `agent/responses-loop.ts`.

import { describe, it, expect } from "vitest";
import { toChatCompletion, toResponsesRequest } from "@/lib/llm/responses-compat";

// ---------------------------------------------------------------------------
// Petición: chat → Responses.
// ---------------------------------------------------------------------------

describe("toResponsesRequest — mensajes y parámetros de chat", () => {
  it("traduce una llamada de landing (system+user, max_completion_tokens, temperature)", () => {
    const body = toResponsesRequest(
      {
        model: "gpt-5.4-mini",
        max_completion_tokens: 700,
        temperature: 0.3,
        messages: [
          { role: "system", content: "Eres experto en agentes" },
          { role: "user", content: "Mejora este prompt" },
        ],
      },
      "low"
    );

    expect(body).toEqual({
      model: "gpt-5.4-mini",
      store: false,
      input: [
        { role: "system", content: "Eres experto en agentes" },
        { role: "user", content: "Mejora este prompt" },
      ],
      max_output_tokens: 700,
      // El effort se resuelve contra el catálogo del modelo, igual que hoy en chat.
      reasoning: { effort: "low" },
    });
    // Sin `messages` (chat) ni `temperature` (un razonador sólo admite el default).
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("temperature");
  });

  it("`max_tokens` (legado) también se traduce a `max_output_tokens`", () => {
    const body = toResponsesRequest({
      model: "gpt-5.4-mini",
      max_tokens: 120,
      messages: [{ role: "user", content: "hola" }],
    });
    expect(body.max_output_tokens).toBe(120);
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("sin tope en el body NO se inventa uno: un estudio largo no puede quedar cortado", () => {
    // market-study/competitors y study-generator llaman sin tope de tokens.
    const body = toResponsesRequest({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Analiza" }],
      temperature: 0.4,
    });
    expect(body).not.toHaveProperty("max_output_tokens");
  });

  it("un modelo NO razonador conserva su temperature y no lleva bloque reasoning", () => {
    const body = toResponsesRequest(
      { model: "gpt-4o", messages: [{ role: "user", content: "x" }], temperature: 0.4 },
      "low"
    );
    expect(body.temperature).toBe(0.4);
    expect(body).not.toHaveProperty("reasoning");
  });

  it("un effort que el modelo no acepta cae a su default, no se manda tal cual", () => {
    // 'max' no está en el catálogo del back (ni en el tipo del SDK): nunca sale a la red.
    const body = toResponsesRequest({
      model: "gpt-5.4-mini",
      messages: [],
      reasoning_effort: "max",
    });
    expect(body.reasoning).toEqual({ effort: "none" }); // default de gpt-5.4-mini
  });

  it("un modelo sin efforts declarados no manda bloque reasoning", () => {
    const body = toResponsesRequest({ model: "gpt-4.1", messages: [], reasoning_effort: "high" });
    expect(body).not.toHaveProperty("reasoning");
  });

  it("`response_format: json_object` (scraper) se traduce a text.format", () => {
    const body = toResponsesRequest({
      model: "gpt-5.4-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: "Devuelve JSON" }],
    });
    expect(body.text).toEqual({ format: { type: "json_object" } });
    expect(body).not.toHaveProperty("response_format");
  });

  it("`response_format: json_schema` se traduce a text.format con nombre y schema", () => {
    const body = toResponsesRequest({
      model: "gpt-5.4-mini",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "estudio",
          description: "Secciones del estudio",
          schema: { type: "object", properties: {} },
          strict: true,
        },
      },
      messages: [],
    });
    expect(body.text).toEqual({
      format: {
        type: "json_schema",
        name: "estudio",
        description: "Secciones del estudio",
        schema: { type: "object", properties: {} },
        strict: true,
      },
    });
  });

  it("aplana las herramientas de chat con strict:false, como el bucle del agente", () => {
    const body = toResponsesRequest({
      model: "gpt-5.4-mini",
      messages: [{ role: "user", content: "x" }],
      tools: [
        {
          type: "function",
          function: {
            name: "buscar",
            description: "Busca",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        },
      ],
    });
    expect(body.tools).toEqual([
      {
        type: "function",
        name: "buscar",
        description: "Busca",
        parameters: { type: "object", properties: { q: { type: "string" } } },
        strict: false,
      },
    ]);
  });

  it("un hilo con tool calls se traduce a function_call / function_call_output", () => {
    const body = toResponsesRequest({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: "Eres Bot" },
        { role: "user", content: "hola" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "buscar", arguments: '{"q":"x"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "resultado" },
      ],
    });

    expect(body.input).toEqual([
      { role: "system", content: "Eres Bot" },
      { role: "user", content: "hola" },
      { type: "function_call", call_id: "call_1", name: "buscar", arguments: '{"q":"x"}' },
      { type: "function_call_output", call_id: "call_1", output: "resultado" },
    ]);
  });

  it("no reenvía campos que sólo existen en chat (n, stop, seed, stream)", () => {
    const body = toResponsesRequest({
      model: "gpt-5.4-mini",
      messages: [{ role: "user", content: "x" }],
      n: 2,
      stop: ["\n\n"],
      seed: 7,
      stream: false,
    });
    expect(Object.keys(body).sort()).toEqual(["input", "model", "reasoning", "store"]);
    expect(body).not.toHaveProperty("n");
    expect(body).not.toHaveProperty("stop");
    expect(body).not.toHaveProperty("seed");
    expect(body).not.toHaveProperty("stream");
  });

  it("es puro: no muta el body ni los mensajes de entrada", () => {
    const messages = [{ role: "user", content: "x" }];
    const body = {
      model: "gpt-5.4-mini",
      messages,
      max_completion_tokens: 10,
      temperature: 0.2,
      reasoning_effort: "high",
    };
    toResponsesRequest(body, "low");
    expect(body).toEqual({
      model: "gpt-5.4-mini",
      messages,
      max_completion_tokens: 10,
      temperature: 0.2,
      reasoning_effort: "high",
    });
    expect(messages[0]).toEqual({ role: "user", content: "x" });
  });
});

// ---------------------------------------------------------------------------
// Respuesta: Response → ChatCompletion.
// ---------------------------------------------------------------------------

function responsesReply(over: Record<string, unknown> = {}) {
  return {
    id: "resp_1",
    object: "response",
    created_at: 1700000000,
    model: "gpt-5.4-mini",
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Hola humano" }],
      },
    ],
    usage: {
      input_tokens: 8,
      output_tokens: 2,
      total_tokens: 10,
      input_tokens_details: { cached_tokens: 4 },
    },
    ...over,
  };
}

describe("toChatCompletion — la forma que el llamador ya conoce", () => {
  it("devuelve choices[0].message.content y el usage traducido", () => {
    const out = toChatCompletion(responsesReply() as never, "gpt-5.4-mini");

    expect(out.choices).toHaveLength(1);
    expect(out.choices[0].message).toEqual({ role: "assistant", content: "Hola humano" });
    expect(out.choices[0].finish_reason).toBe("stop");
    expect(out.usage).toEqual({
      prompt_tokens: 8,
      completion_tokens: 2,
      total_tokens: 10,
      prompt_tokens_details: { cached_tokens: 4 },
    });
    expect(out.model).toBe("gpt-5.4-mini");
    expect(out.object).toBe("chat.completion");
    expect(typeof out.id).toBe("string");
    expect(typeof out.created).toBe("number");
  });

  it("traduce las llamadas a herramienta a message.tool_calls con finish_reason tool_calls", () => {
    const out = toChatCompletion(
      responsesReply({
        output: [
          { type: "reasoning", encrypted_content: "cifrado" },
          {
            type: "function_call",
            call_id: "call_9",
            name: "buscar",
            arguments: '{"q":"x"}',
          },
        ],
        usage: undefined,
      }) as never,
      "gpt-5.4-mini"
    );

    expect(out.choices[0].message.content).toBeNull();
    expect(out.choices[0].message.tool_calls).toEqual([
      { id: "call_9", type: "function", function: { name: "buscar", arguments: '{"q":"x"}' } },
    ]);
    expect(out.choices[0].finish_reason).toBe("tool_calls");
    // Sin usage informado no se inventan tokens (el metering no se falsea).
    expect(out.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  it("una respuesta truncada por tope de tokens se presenta como finish_reason length", () => {
    const out = toChatCompletion(
      responsesReply({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [{ type: "message", role: "assistant", content: [] }],
      }) as never,
      "gpt-5.4-mini"
    );
    expect(out.choices[0].finish_reason).toBe("length");
  });

  it("si el proveedor no informa del caché, no aparece prompt_tokens_details (no se inventa un 0)", () => {
    const out = toChatCompletion(
      responsesReply({
        usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
      }) as never,
      "gpt-5.4-mini"
    );
    expect(out.usage).toEqual({ prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 });
    expect(out.usage).not.toHaveProperty("prompt_tokens_details");
  });

  it("una respuesta vacía no revienta: contenido nulo y ceros", () => {
    const out = toChatCompletion({} as never, "gpt-5.4-mini");
    expect(out.choices[0].message).toEqual({ role: "assistant", content: null });
    expect(out.choices[0].finish_reason).toBe("stop");
    expect(out.usage.total_tokens).toBe(0);
  });
});
