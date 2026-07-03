/**
 * Slug estable del agente OpenClaw derivado del id de Agent de agents-agency.
 * Módulo hoja (sin dependencias) para evitar ciclos entre lib/openai.ts y
 * lib/openclaw/provision.ts, que ambos lo necesitan.
 */
export function openclawAgentId(agentId: string): string {
  return `aa-${agentId}`;
}
