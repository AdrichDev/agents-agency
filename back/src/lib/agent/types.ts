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
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
