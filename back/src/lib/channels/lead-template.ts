/**
 * Config de la plantilla de primer contacto (aa-lead-whatsapp-kickoff F3,
 * design.md §D).
 *
 * Precedencia: `AgentDataBackend.notificationConfig.leadTemplate`
 * (name/language/bodyVars/bodyText) > env `META_LEAD_TEMPLATE_NAME` /
 * `META_LEAD_TEMPLATE_LANG` > defaults. El kickoff-token per-agente vive en
 * `notificationConfig.kickoffToken` (gate del endpoint público).
 *
 * IMPORTANTE: el envío real lo hace Meta con la plantilla APROBADA; aquí solo
 * resolvemos qué plantilla/idioma usar y renderizamos un texto aproximado para
 * sembrar el `Message` assistant (contexto del primer turno reactivo del LLM).
 */

/** Config resuelta de la plantilla de primer contacto. */
export interface LeadTemplateConfig {
  name: string;
  language: string;
  /** Nombres de variables del cuerpo en orden (p. ej. ["nombre"]). */
  bodyVars: string[];
  /** Texto opcional con placeholders {{1}},{{2}}... para sembrar el Message. */
  bodyText?: string;
}

/** Datos del lead con los que se rellenan las variables de la plantilla. */
export interface LeadData {
  nombre: string;
  email?: string;
  telefono?: string;
  peticion?: string;
}

const DEFAULT_TEMPLATE_NAME = "lead_primer_contacto";
const DEFAULT_LANG = "es";
const DEFAULT_BODY_VARS = ["nombre"];

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Resuelve la config de plantilla con precedencia notificationConfig > env >
 * default. `notificationConfig` llega como Json laxo de Prisma.
 */
export function resolveLeadTemplate(notificationConfig: unknown): LeadTemplateConfig {
  const cfg = (notificationConfig ?? {}) as Record<string, unknown>;
  const lt = (cfg.leadTemplate ?? {}) as Record<string, unknown>;

  const name =
    trimmedString(lt.name) ??
    trimmedString(process.env.META_LEAD_TEMPLATE_NAME) ??
    DEFAULT_TEMPLATE_NAME;
  const language =
    trimmedString(lt.language) ??
    trimmedString(process.env.META_LEAD_TEMPLATE_LANG) ??
    DEFAULT_LANG;
  const bodyVars = Array.isArray(lt.bodyVars)
    ? lt.bodyVars.filter((v): v is string => typeof v === "string")
    : DEFAULT_BODY_VARS;
  const bodyText = trimmedString(lt.bodyText);

  return { name, language, bodyVars, ...(bodyText ? { bodyText } : {}) };
}

/** Rellena las variables del cuerpo en el orden declarado por `bodyVars`. */
export function renderBodyParams(config: LeadTemplateConfig, lead: LeadData): string[] {
  const source = lead as unknown as Record<string, unknown>;
  return config.bodyVars.map((varName) => {
    const value = source[varName];
    return typeof value === "string" ? value : "";
  });
}

/**
 * Texto aproximado sembrado como `Message` assistant. Si hay `bodyText` con
 * placeholders {{n}}, se interpolan los `bodyParams`; si no, se usa un saludo
 * por defecto con el primer parámetro (nombre) para dar contexto al LLM.
 */
export function renderTemplateText(config: LeadTemplateConfig, bodyParams: string[]): string {
  if (config.bodyText) {
    return config.bodyText.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => {
      const idx = Number(n) - 1;
      return bodyParams[idx] ?? "";
    });
  }
  const nombre = bodyParams[0] ?? "";
  return nombre
    ? `Hola ${nombre}, gracias por tu interés. ¿En qué puedo ayudarte?`
    : "Hola, gracias por tu interés. ¿En qué puedo ayudarte?";
}

/** Kickoff-token per-agente (gate del endpoint). Sin token configurado → undefined. */
export function resolveKickoffToken(notificationConfig: unknown): string | undefined {
  const cfg = (notificationConfig ?? {}) as Record<string, unknown>;
  return trimmedString(cfg.kickoffToken);
}
