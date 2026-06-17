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
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
