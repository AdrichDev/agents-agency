export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface ToolCallRecord {
  tool: string;
  input: unknown;
  output: unknown;
  error?: string;
}

export interface AgentReply {
  text: string;
  toolCalls: ToolCallRecord[];
  /** Tokens totales consumidos por las llamadas LLM de esta respuesta (metering). */
  tokensUsed?: number;
  /** Modelo usado (para el log de consumo). */
  model?: string;
  /** Wall-time del turno (ms), aditivo — F1 aa-agente-consola-pruebas T1.1. */
  latencyMs?: number;
  /**
   * Tenant contra el que contabilizar el consumo, resuelto en `runAgent` desde la BD
   * (H1 aa-metering-fail-closed). Es la fuente de verdad para `deductTokens`: no se
   * confía en el tenantId que pase el llamador. `null` sólo en conversaciones de prueba
   * de agentes sin tenant asignado.
   */
  meteredTenantId?: string | null;
  /**
   * Modo de credenciales con el que se sirvió esta respuesta ("platform" | "byok")
   * (H2 aa-credenciales-byok-multiproveedor). Lo necesita `deductTokens` para decidir si el
   * consumo va contra el cupo y para dejarlo registrado en `uso_tokens`. Interno como
   * `meteredTenantId`: NO sale hacia la respuesta pública de `/api/chat`.
   */
  credentialMode?: string;
  /**
   * F (aa-agentes-economia-tokens, T6.1): desglose del consumo, para saber lo que costó de verdad.
   *
   * `tokensUsed` es lo que se imputa al cupo del cliente y NO cambia. Esto es otra cosa: los tokens
   * de entrada que el proveedor sirvió de su caché de prefijo salen mucho más baratos que los que
   * procesa de cero, así que sin este dato el coste real es una incógnita y las palancas de caché
   * (T4.1) no se pueden verificar, sólo suponer. Se guarda en `TokenUsage.contexto`.
   *
   * `iterations` va aquí por el mismo motivo: es la comprobación en producción de que el mensaje
   * típico se resuelve en UNA llamada al LLM (AC1) y no en dos.
   */
  usageBreakdown?: { promptTokens: number; cachedTokens: number; iterations: number };
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
