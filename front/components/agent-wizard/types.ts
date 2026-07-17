export interface Skill {
  id: string;
  name: string;
  description: string;
  type: string; // SKILL | AGENT | EXTENSION | PLUGIN | MCP
  use: string;  // uso funcional en UPPERCASE (solo etiqueta de catálogo)
  /** Facultad declarada (clave del catálogo de tools del back) o null = informativa. */
  toolsProvider?: string | null;
}

/** Capabilities habilitables del backend de datos (espejo del back, F4). */
export type BackendCapability = "reservas" | "leads" | "pedidos";

/**
 * Modo del backend de datos del agente (paso "Datos del negocio", F4
 * aa-agent-backend-foundation). "" = sin elegir: la selección es OBLIGATORIA,
 * sin default silencioso. external_api = backlog v2.
 */
export type DataBackendMode = "" | "managed_db" | "none_yet";

export interface WidgetTemplateConfig {
  position: "right" | "left";
  launcherShape: "circle" | "rounded";
  panelSize: "compact" | "normal" | "wide";
}

export interface AgentWizardForm {
  clientMode: "existing" | "new";
  tenantId: string;
  clientName: string;
  website: string;
  sector: string;
  name: string;
  systemPrompt: string;
  /** Cerebro del agente: "openclaw" (gateway local) u "openai" (cloud OpenAI/Gemini). */
  runtime: "openclaw" | "openai";
  model: string;
  reasoningEffort: string;
  temperature: number;
  /**
   * Las skills ya no se eligen en el wizard (H3): se configuran tras crear el
   * agente en la pestaña Skills de la ficha. El campo se conserva por
   * retrocompat del form/draft; el POST de creación siempre envía [].
   */
  skillIds: string[];
  dataBackendMode: DataBackendMode;
  dataBackendCapabilities: BackendCapability[];
  channel: string;
  widgetPrimaryColor: string;
  widgetSecondaryColor: string;
  widgetAvatarBase64: string;
  widgetAvatarEmoji: string;
  widgetTemplateConfig: WidgetTemplateConfig;
}

