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
import { AGENCY_PROFILE, buildCatalogValueContext } from "./agency-profile";

const PLACEHOLDER = "Contenido no disponible — regenerar sección";
const INSUFFICIENT_BANNER = "Base de datos insuficiente — estimaciones de mercado sin respaldo de datos reales";

/** Selección de modelo + effort para la generación. */
export interface ModelOptions {
  model?: string;
  reasoningEffort?: string;
}

/**
 * Construye los parámetros extra del modelo: usa el modelo elegido (o STRONG_MODEL)
 * y solo añade reasoning_effort en modelos gpt-5* (los gpt-4* lo rechazan con 400).
 */
function modelParams(opts?: ModelOptions): { model: string; reasoning_effort?: any } {
  const model = opts?.model || STRONG_MODEL;
  const params: { model: string; reasoning_effort?: any } = { model };
  if (model.startsWith("gpt-5") && opts?.reasoningEffort) {
    // 'minimal' ya no lo aceptan los gpt-5.4 → remapeo a 'low' (igual que el wrapper).
    params.reasoning_effort = opts.reasoningEffort === "minimal" ? "low" : opts.reasoningEffort;
  }
  return params;
}

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
      tenant: { select: { sector: true } },
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

    const sector = budget.tenant?.sector ?? "unknown";

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
    if (budget.tenantId) {
      clientSectorMap.get(sector)!.add(budget.tenantId);
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

  const totalClients = await prisma.tenant.count();

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

/** Real price catalog rendered as a markdown table for the pricing prompt. */
function buildCatalogContext(): string {
  const rows = SERVICE_CATALOG.map(
    (s) => `| ${s.name} | ${s.implPrice.toLocaleString("es-ES")} € | ${s.maintPrice.toLocaleString("es-ES")} €/mes | ${s.description} |`
  );
  return [
    "| Servicio | Implantación | Mantenimiento | Descripción |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

export function buildSystemPrompt(
  realData: RealBusinessData,
  inputs: MarketStudyInputs,
  prospectStatsBlock?: string
): string {
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

  const zoneLabel = `${inputs.zone}${inputs.postalCode ? ` (CP ${inputs.postalCode})` : ""}`;
  const radiusLabel = `${inputs.radiusKm} km`;

  return `Eres un consultor senior de estrategia de mercado (perfil McKinsey/BCG) especializado en negocios locales y PYMEs.
Tu tarea es generar un estudio de mercado estructurado en JSON, HIPERLOCAL, REALISTA y accionable: el tipo de documento por el que un cliente pagaría y sobre el que tomaría decisiones de inversión.

${AGENCY_PROFILE}

${hasData ? "" : `BANNER OBLIGATORIO: Incluye al inicio del executive_summary la frase exacta: "${INSUFFICIENT_BANNER}"\n`}
${dataContext}
${prospectStatsBlock ? `\n${prospectStatsBlock}\n` : ""}
ÁMBITO GEOGRÁFICO DEL ESTUDIO (OBLIGATORIO EN TODAS LAS SECCIONES):
- Zona principal: ${zoneLabel}
- Radio de acción: ${radiusLabel} alrededor de ${inputs.zone}
- Zonas de expansión: ${inputs.expansionZones.join(", ") || "ninguna indicada"}
- Sectores objetivo: ${inputs.targetSectors.join(", ")}
- Presupuesto medio estimado por cliente: ${inputs.avgBudget ? `${inputs.avgBudget.toLocaleString("es-ES")} €` : "no indicado"}

ANCLAJE GEOGRÁFICO (CRÍTICO):
- CADA sección debe referirse explícitamente a ${inputs.zone} y a su radio de ${radiusLabel}. Un lector debe poder saber de qué zona habla el estudio leyendo cualquier sección suelta.
- Menciona barrios, distritos, calles comerciales, polígonos o municipios REALES dentro de ese radio cuando los conozcas (p.ej. zonas de mayor densidad comercial de ${inputs.zone}).
- PROHIBIDO redactar contenido genérico que valdría para cualquier ciudad. Si una frase no menciona la zona, un dato o un sector concreto, reescríbela.
- En zone_analysis: describe la estructura comercial real de ${inputs.zone} dentro del radio (áreas con más negocios de los sectores objetivo, perfil demográfico, tejido empresarial).
- En target_segments: estima el número de negocios por sector dentro del radio de ${radiusLabel} con cifra concreta "(estimación)".

METODOLOGÍA DE DIMENSIONAMIENTO DE MERCADO (OBLIGATORIA, realismo > optimismo):
- Dimensiona el mercado en TAM / SAM / SOM con cifras concretas EN € y EN nº de negocios para el radio de ${radiusLabel}:
  · TAM = total de negocios de los sectores objetivo en el radio × valor 12m medio de cliente.
  · SAM = subconjunto realmente alcanzable (los que encajan con nuestro core: sin web o con web sin chatbot).
  · SOM = lo que es realista captar en 12 meses (sé conservador: una agencia pequeña cierra una fracción pequeña; usa una tasa de captación realista del 1-5% del SAM y JUSTIFÍCALA).
- Si te apoyas en los DATOS REALES DE PROSPECCIÓN, trátalos como cifras verificadas; el resto son "(estimación)" o "(supuesto)".
- Construye un EMBUDO de conversión con números: negocios objetivo → % contactables → % que responden → % que cierran → nº de clientes → € de pipeline (implantación + mantenimiento×12 usando el catálogo).
- Etiqueta cada supuesto con "(supuesto)" y añade un nivel de confianza (alta/media/baja) a las estimaciones clave.
- Evita el optimismo irreal: si los datos son escasos, dilo y baja el nivel de confianza en lugar de inflar cifras.

REGLAS DE CONCRECIÓN (CRÍTICAS):
1. PROHIBIDO el relleno genérico y el lenguaje evasivo: nada de "depende del mercado", "puede variar", "en general", "es importante considerar".
2. Cada afirmación relevante debe apoyarse en un dato concreto: número, porcentaje, precio en €, plazo en semanas o nombre de zona/sector.
3. Las estimaciones se dan SIEMPRE con cifra concreta y etiqueta "(estimación)" o "(supuesto)" — nunca como rango vago sin números.
4. NUNCA inventes cifras de facturación, clientes o presupuestos del negocio propio.
5. NUNCA inventes competidores que no hayan sido proporcionados explícitamente.
6. Relaciona SIEMPRE las recomendaciones con nuestro core: qué servicio del catálogo encaja con qué segmento de ${inputs.zone} y por qué.
7. Responde ÚNICAMENTE con el JSON indicado, sin markdown, sin explicaciones.

VALOR DE CLIENTE A 12 MESES POR SERVICIO (para los cálculos de pipeline y SOM):
${buildCatalogValueContext()}

CATÁLOGO DE SERVICIOS Y PRECIOS REALES DE LA AGENCIA (única fuente válida para precios):
${buildCatalogContext()}

REGLAS DE PRICING (sección suggested_pricing):
- Usa EXCLUSIVAMENTE los precios del catálogo anterior: cítalos tal cual (nombre del servicio + precio de implantación + mantenimiento mensual).
- Propón 2-3 packs combinando servicios del catálogo, sumando los importes reales y mostrando el total exacto en €.
- Si recomiendas un descuento o ajuste para ${inputs.zone}, indica el % y el precio final resultante.
- PROHIBIDO inventar precios o servicios que no estén en el catálogo.
- Relaciona cada servicio recomendado con los sectores objetivo de la zona (qué servicio encaja con qué sector y por qué).

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
    {"key": "action_plan", "title": "Plan de Acción", "markdown": "Pasos concretos para ${inputs.zone} con plazos estimados (semanas/meses)..."},
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
  iteration?: StudyIterationContext,
  prospectStatsBlock?: string,
  modelOpts?: ModelOptions
): Promise<GenerateStudyResult> {
  const systemPrompt = buildSystemPrompt(realData, inputs, prospectStatsBlock);

  const userMessage = iteration && iteration.previousSections.length > 0
    ? buildIterationUserMessage(iteration)
    : "Genera el estudio de mercado completo en formato JSON.";

  const response = await openai.chat.completions.create({
    ...modelParams(modelOpts),
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
  currentSections: StudySection[],
  prospectStatsBlock?: string,
  modelOpts?: ModelOptions
): Promise<StudySection> {
  const sectionTitle = SECTION_TITLES[sectionKey as StudySectionKey] ?? sectionKey;

  const otherSections = currentSections
    .filter((s) => s.key !== sectionKey)
    .map((s) => `### ${s.title}\n${s.markdown.substring(0, 200)}...`)
    .join("\n\n");

  const systemPrompt = buildSystemPrompt(realData, inputs, prospectStatsBlock);

  const response = await openai.chat.completions.create({
    ...modelParams(modelOpts),
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
