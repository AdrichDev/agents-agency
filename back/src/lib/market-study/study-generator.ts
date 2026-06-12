import { prisma } from "@/lib/db";
import { openai, STRONG_MODEL } from "@/lib/openai";
import { SERVICE_CATALOG } from "@/lib/service-catalog";
import {
  MarketStudyInputs,
  RealBusinessData,
  StudySection,
  STUDY_SECTION_KEYS,
  SECTION_TITLES,
  StudySectionKey,
} from "./types";

const PLACEHOLDER = "Contenido no disponible — regenerar sección";
const INSUFFICIENT_BANNER = "Base de datos insuficiente — estimaciones de mercado sin respaldo de datos reales";

// Core section keys (7 original)
const CORE_SECTION_KEYS = STUDY_SECTION_KEYS.filter(
  (k) => !["action_plan", "recommended_options", "competitors"].includes(k)
);

// ── Collect real business data ────────────────────────────────────────────

export async function collectRealData(): Promise<RealBusinessData> {
  const acceptedBudgets = await prisma.budget.findMany({
    where: { status: "accepted" },
    include: {
      lines: { select: { serviceId: true, quantity: true, implPrice: true, maintPrice: true } },
      client: { select: { sector: true } },
    },
  });

  const acceptedBudgetCount = acceptedBudgets.length;
  let totalAcceptedRevenue = 0;

  const revenueByServiceMap = new Map<string, number>();
  const revenueByServiceAndSectorMap = new Map<string, number>();
  const clientSectorMap = new Map<string, Set<string>>();

  for (const budget of acceptedBudgets) {
    const budgetTotal = budget.totalImpl + budget.totalMaint;
    totalAcceptedRevenue += budgetTotal;

    const sector = budget.client?.sector ?? "unknown";

    for (const line of budget.lines) {
      const lineRevenue = (line.implPrice + line.maintPrice) * line.quantity;
      const existing = revenueByServiceMap.get(line.serviceId) ?? 0;
      revenueByServiceMap.set(line.serviceId, existing + lineRevenue);

      const key = `${line.serviceId}::${sector}`;
      const existingKey = revenueByServiceAndSectorMap.get(key) ?? 0;
      revenueByServiceAndSectorMap.set(key, existingKey + lineRevenue);
    }

    if (!clientSectorMap.has(sector)) {
      clientSectorMap.set(sector, new Set());
    }
    // track client ids per sector
    if (budget.clientId) {
      clientSectorMap.get(sector)!.add(budget.clientId);
    }
  }

  const avgAcceptedTicket = acceptedBudgetCount > 0
    ? Math.round(totalAcceptedRevenue / acceptedBudgetCount)
    : 0;

  const revenueByService = Array.from(revenueByServiceMap.entries()).map(([serviceId, total]) => ({
    serviceId,
    name: SERVICE_CATALOG.find((s) => s.id === serviceId)?.name ?? serviceId,
    total: Math.round(total * 100) / 100,
  })).sort((a, b) => b.total - a.total);

  const clientsBySector = Array.from(clientSectorMap.entries()).map(([sector, ids]) => ({
    sector,
    count: ids.size,
  })).sort((a, b) => b.count - a.count);

  const revenueByServiceAndSector = Array.from(revenueByServiceAndSectorMap.entries()).map(
    ([key, total]) => {
      const [serviceId, sector] = key.split("::");
      return { serviceId, sector, total: Math.round(total * 100) / 100 };
    }
  );

  const totalClients = await prisma.client.count();

  return {
    acceptedBudgetCount,
    totalAcceptedRevenue: Math.round(totalAcceptedRevenue * 100) / 100,
    avgAcceptedTicket,
    activeClientCount: totalClients,
    revenueByService,
    clientsBySector,
    revenueByServiceAndSector,
  };
}

// ── Build system prompt ───────────────────────────────────────────────────

function buildSystemPrompt(realData: RealBusinessData, inputs: MarketStudyInputs): string {
  const hasData = realData.acceptedBudgetCount > 0;

  // Success cases: top sectors + services from accepted budgets
  const successCasesContext = hasData && realData.clientsBySector.length > 0
    ? `CASOS DE ÉXITO PROPIOS (casos reales, no inventados):
- Sectores con más clientes: ${realData.clientsBySector.slice(0, 3).map((s) => `${s.sector} (${s.count} clientes)`).join(", ")}
- Servicios más rentables: ${realData.revenueByService.slice(0, 3).map((s) => `${s.name}: ${s.total.toLocaleString("es-ES")} €`).join(", ")}
`
    : "";

  const dataContext = hasData
    ? `
DATOS REALES DEL NEGOCIO (NO inventar):
- Presupuestos aceptados: ${realData.acceptedBudgetCount}
- Facturación total aceptada: ${realData.totalAcceptedRevenue.toLocaleString("es-ES")} €
- Ticket medio aceptado: ${realData.avgAcceptedTicket.toLocaleString("es-ES")} €
- Clientes activos: ${realData.activeClientCount}
- Facturación por servicio: ${realData.revenueByService.map((s) => `${s.name}: ${s.total.toLocaleString("es-ES")} €`).join(", ") || "sin datos"}
- Clientes por sector: ${realData.clientsBySector.map((s) => `${s.sector}: ${s.count}`).join(", ") || "sin datos"}

${successCasesContext}`
    : `
ADVERTENCIA: No existen presupuestos aceptados en la base de datos.
Todas las estimaciones de mercado deben marcarse como "estimación" y NO como datos reales.
`;

  return `Eres un consultor experto en análisis de mercado para empresas de tecnología e IA.
Tu tarea es generar un estudio de mercado estructurado en JSON.

${hasData ? "" : `BANNER OBLIGATORIO: Incluye al inicio del executive_summary la frase exacta: "${INSUFFICIENT_BANNER}"\n`}
${dataContext}

INPUTS DEL ESTUDIO:
- Zona: ${inputs.zone}${inputs.postalCode ? ` (CP: ${inputs.postalCode})` : ""}
- Radio de búsqueda: ${inputs.radiusKm} km
- Zonas de expansión: ${inputs.expansionZones.join(", ") || "ninguna indicada"}
- Sectores objetivo: ${inputs.targetSectors.join(", ")}
- Presupuesto medio estimado: ${inputs.avgBudget ? `${inputs.avgBudget.toLocaleString("es-ES")} €` : "no indicado"}

REGLAS:
1. NUNCA inventes cifras de facturación, clientes o presupuestos del negocio propio.
2. NUNCA inventes competidores que no hayan sido proporcionados explícitamente.
3. Las estimaciones de tamaño de mercado DEBEN llevar la etiqueta "(estimación)".
4. Responde ÚNICAMENTE con el JSON indicado, sin markdown, sin explicaciones.

SECCIONES REQUERIDAS (array JSON de 9 elementos + campo successScore):
{
  "sections": [
    {"key": "executive_summary", "title": "Resumen Ejecutivo", "markdown": "..."},
    {"key": "swot", "title": "Análisis DAFO", "markdown": "..."},
    {"key": "target_segments", "title": "Segmentos Objetivo", "markdown": "..."},
    {"key": "zone_analysis", "title": "Análisis de Zona", "markdown": "..."},
    {"key": "suggested_pricing", "title": "Pricing Sugerido", "markdown": "..."},
    {"key": "expansion_plan", "title": "Plan de Expansión", "markdown": "..."},
    {"key": "next_steps", "title": "Próximos Pasos", "markdown": "..."},
    {"key": "action_plan", "title": "Plan de Acción", "markdown": "Pasos concretos con plazos estimados (semanas/meses)..."},
    {"key": "recommended_options", "title": "Opciones Recomendadas de Actuación", "markdown": "...", "options": [
      {"title": "...", "description": "...", "successScore": 4, "rationale": "..."}
    ]}
  ],
  "successScore": 3,
  "successScoreRationale": "Justificación del score global del estudio..."
}`;
}

// ── Parse sections defensively ───────────────────────────────────────────

function parseSections(raw: string, coreSectionsOnly = false): StudySection[] {
  const result: StudySection[] = [];
  const keysToUse = coreSectionsOnly ? CORE_SECTION_KEYS : STUDY_SECTION_KEYS;

  // Try full parse first
  try {
    const parsed = JSON.parse(raw);
    // Support both array format (legacy) and {sections: [...]} format (new)
    const sectionsArray = Array.isArray(parsed) ? parsed : (parsed?.sections ?? []);

    if (Array.isArray(sectionsArray)) {
      for (const sectionKey of keysToUse) {
        const found = sectionsArray.find((s: any) => s?.key === sectionKey);
        result.push({
          key: sectionKey,
          title: found?.title ?? SECTION_TITLES[sectionKey as StudySectionKey],
          markdown: typeof found?.markdown === "string" && found.markdown.trim()
            ? found.markdown
            : PLACEHOLDER,
        });
      }
      return result;
    }
  } catch {
    // fallthrough to per-section extraction
  }

  // Defensive: extract sections individually from raw text
  for (const sectionKey of keysToUse) {
    const title = SECTION_TITLES[sectionKey as StudySectionKey];
    // Try to find this section in the raw text
    const keyPattern = new RegExp(`"key"\\s*:\\s*"${sectionKey}"[^}]*"markdown"\\s*:\\s*"([^"]*)"`, "s");
    const match = raw.match(keyPattern);
    result.push({
      key: sectionKey,
      title,
      markdown: match ? match[1].replace(/\\n/g, "\n") : PLACEHOLDER,
    });
  }

  return result;
}

// ── Extract successScore from LLM response ───────────────────────────────

function extractSuccessScore(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw);
    const score = parsed?.successScore;
    if (typeof score === "number" && score >= 1 && score <= 5) {
      return Math.round(score);
    }
  } catch {
    // try regex fallback
  }
  const match = raw.match(/"successScore"\s*:\s*([1-5])/);
  if (match) return parseInt(match[1], 10);
  return null;
}

// ── Iteration user message ────────────────────────────────────────────────

const MAX_SECTION_CHARS_FOR_ITERATION = 1500;

export interface StudyIterationContext {
  previousSections: StudySection[];
  feedback?: string;
}

function buildIterationUserMessage(iteration: StudyIterationContext): string {
  const previous = iteration.previousSections
    .map((s) => {
      const body = s.markdown.length > MAX_SECTION_CHARS_FOR_ITERATION
        ? `${s.markdown.substring(0, MAX_SECTION_CHARS_FOR_ITERATION)}\n[... contenido recortado ...]`
        : s.markdown;
      return `### ${s.title} (key: ${s.key})\n${body}`;
    })
    .join("\n\n");

  const feedbackBlock = iteration.feedback?.trim()
    ? `\nINSTRUCCIONES DEL USUARIO PARA ESTA ITERACIÓN:\n${iteration.feedback.trim()}\n`
    : "";

  return `ESTUDIO ACTUAL (versión previa, puede incluir ediciones manuales del usuario):

${previous}
${feedbackBlock}
Itera sobre este estudio: actualiza lo afectado por los nuevos inputs/feedback, conserva y mejora lo que siga siendo válido, no pierdas información valiosa.
Recalcula el successScore según el estado actual del estudio.
Genera el estudio de mercado completo actualizado en formato JSON.`;
}

// ── Generate full study ───────────────────────────────────────────────────

export interface GenerateStudyResult {
  sections: StudySection[];
  successScore: number | null;
}

export async function generateStudy(
  inputs: MarketStudyInputs,
  realData: RealBusinessData,
  competitorSection?: StudySection,
  iteration?: StudyIterationContext
): Promise<GenerateStudyResult> {
  const systemPrompt = buildSystemPrompt(realData, inputs);

  const userMessage = iteration && iteration.previousSections.length > 0
    ? buildIterationUserMessage(iteration)
    : "Genera el estudio de mercado completo en formato JSON.";

  const response = await openai.chat.completions.create({
    model: STRONG_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.4,
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? "{}";

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  // Parse sections (without competitors — that comes from Places)
  const sections = parseSections(cleaned, false);

  // Inject competitor section if provided
  if (competitorSection) {
    const idx = sections.findIndex((s) => s.key === "competitors");
    if (idx !== -1) {
      sections[idx] = competitorSection;
    } else {
      sections.push(competitorSection);
    }
  }

  const successScore = extractSuccessScore(cleaned);

  return { sections, successScore };
}

// ── Regenerate single section ─────────────────────────────────────────────

export async function regenerateSection(
  sectionKey: string,
  inputs: MarketStudyInputs,
  realData: RealBusinessData,
  currentSections: StudySection[]
): Promise<StudySection> {
  const sectionTitle = SECTION_TITLES[sectionKey as StudySectionKey] ?? sectionKey;

  const otherSections = currentSections
    .filter((s) => s.key !== sectionKey)
    .map((s) => `### ${s.title}\n${s.markdown.substring(0, 200)}...`)
    .join("\n\n");

  const systemPrompt = buildSystemPrompt(realData, inputs);

  const response = await openai.chat.completions.create({
    model: STRONG_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Regenera ÚNICAMENTE la sección "${sectionTitle}" (key: "${sectionKey}").
Otras secciones del estudio (contexto):
${otherSections}

Responde ÚNICAMENTE con el objeto JSON de esa sección:
{"key": "${sectionKey}", "title": "${sectionTitle}", "markdown": "..."}`,
      },
    ],
    temperature: 0.4,
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? "{}";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed?.key === sectionKey && typeof parsed?.markdown === "string") {
      return { key: sectionKey, title: sectionTitle, markdown: parsed.markdown };
    }
  } catch {
    // fallback
  }

  // Try extracting markdown from raw text
  const markdownMatch = cleaned.match(/"markdown"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
  return {
    key: sectionKey,
    title: sectionTitle,
    markdown: markdownMatch ? markdownMatch[1].replace(/\\n/g, "\n") : PLACEHOLDER,
  };
}
