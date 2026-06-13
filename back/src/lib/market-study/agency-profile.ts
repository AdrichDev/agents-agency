// Core/business profile of the agency. Single source of truth shared by the
// study generator and the prompt-master so every generated study and every
// auto-generated prompt is grounded in WHO we are and WHAT we sell.

import { SERVICE_CATALOG } from "@/lib/service-catalog";
import type { Prospect } from "./types";

/**
 * Concise positioning of the agency. Kept deliberately factual: it describes the
 * core business, the ideal customer and the value proposition so the model can
 * reason about fit without inventing capabilities we do not offer.
 */
export const AGENCY_PROFILE = `NUESTRA AGENCIA (CORE DE NEGOCIO — base para todo el análisis):
- Qué somos: agencia de soluciones de IA aplicada para PYMEs y negocios locales.
- Qué vendemos (y NADA más): agentes/chatbots de IA (web, WhatsApp, email), webs profesionales con o sin chatbot integrado, y automatización de procesos (RPA/n8n: email, CRM, facturación, notificaciones).
- Cliente ideal: negocio local o PYME con presencia digital débil o nula (sin web, o con web pero sin atención automatizada) que pierde leads fuera de horario o dedica horas a tareas repetitivas.
- Propuesta de valor: captar y atender leads 24/7, reducir trabajo manual y profesionalizar la presencia digital con implantación rápida y mantenimiento mensual asequible.
- Modelo de ingresos: pago de implantación (one-off) + cuota de mantenimiento mensual recurrente. El valor de cliente a 12 meses = implantación + (mantenimiento × 12).
- Cómo cualificamos oportunidades: prioridad a negocios SIN web (máxima oportunidad), después web SIN chatbot; los que ya tienen chatbot son baja prioridad.`;

/** Estimated 12-month customer value for each service (impl + maint×12). */
export function buildCatalogValueContext(): string {
  const rows = SERVICE_CATALOG.map((s) => {
    const ltv = s.implPrice + s.maintPrice * 12;
    return `- ${s.name}: implantación ${s.implPrice.toLocaleString("es-ES")} € + ${s.maintPrice.toLocaleString("es-ES")} €/mes → valor 12m ≈ ${ltv.toLocaleString("es-ES")} €`;
  });
  return rows.join("\n");
}

export interface ProspectStats {
  total: number;
  noWeb: number;
  webNoChatbot: number;
  webChatbot: number;
  avgRating: number | null;
  highOpportunity: number; // opportunityScore >= 4
  bySector: Array<{ sector: string; count: number }>;
}

/** Aggregates real scraped prospects into figures the study can be anchored on. */
export function computeProspectStats(prospects: Prospect[]): ProspectStats | null {
  const inRadius = prospects.filter((p) => p.outOfRadius !== true);
  if (inRadius.length === 0) return null;

  const ratings = inRadius.map((p) => p.rating).filter((r): r is number => typeof r === "number");
  const sectorMap = new Map<string, number>();
  for (const p of inRadius) {
    const s = p.sector ?? "general";
    sectorMap.set(s, (sectorMap.get(s) ?? 0) + 1);
  }

  return {
    total: inRadius.length,
    noWeb: inRadius.filter((p) => p.websiteStatus === "no_web").length,
    webNoChatbot: inRadius.filter((p) => p.websiteStatus === "web_no_chatbot").length,
    webChatbot: inRadius.filter((p) => p.websiteStatus === "web_chatbot").length,
    avgRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    highOpportunity: inRadius.filter((p) => (p.opportunityScore ?? 0) >= 4).length,
    bySector: Array.from(sectorMap.entries())
      .map(([sector, count]) => ({ sector, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Renders prospect stats as a hard-data block for the system prompt. */
export function renderProspectStats(stats: ProspectStats, radiusKm: number, zone: string): string {
  const pct = (n: number) => (stats.total ? Math.round((n / stats.total) * 100) : 0);
  const bySector = stats.bySector.map((s) => `${s.sector}: ${s.count}`).join(", ");
  return `DATOS REALES DE PROSPECCIÓN (Google Places, dentro del radio de ${radiusKm} km de ${zone} — son la base empírica del estudio, úsalos como cifras verificadas, NO como estimación):
- Negocios analizados en radio: ${stats.total}
- Sin web: ${stats.noWeb} (${pct(stats.noWeb)}%) — oportunidad máxima
- Con web sin chatbot: ${stats.webNoChatbot} (${pct(stats.webNoChatbot)}%)
- Con chatbot ya instalado: ${stats.webChatbot} (${pct(stats.webChatbot)}%)
- Oportunidades de alta prioridad (score ≥ 4): ${stats.highOpportunity}
- Rating medio de los negocios: ${stats.avgRating ?? "N/D"}
- Distribución por sector: ${bySector || "N/D"}`;
}
