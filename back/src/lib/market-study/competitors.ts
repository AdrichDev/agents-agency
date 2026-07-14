import { openai, STRONG_MODEL } from "@/lib/openai";
import { fetchHtml, htmlToText } from "@/lib/scraper/web";
import { extractEmails } from "./email-extractor";
import {
  textSearch,
  getPlaceDetails,
  geocodeZone,
  haversineKm,
  type LatLng,
  type TextSearchOptions,
} from "./places";
import type { StudySection, MarketStudyInputs } from "./types";

export interface Competitor {
  placeId: string;
  name: string;
  website?: string;
  email?: string;
  rating?: number;
  services?: string;  // LLM-extracted summary
}

const MAX_COMPETITORS = 8;
const MAX_SCRAPE_CHARS = 4_000;
const SCRAPE_TIMEOUT_MS = 10_000;

const COMPETITOR_QUERIES = [
  "agencia inteligencia artificial",
  "agencia ia",
  "agencia marketing digital ia",
  "desarrollo inteligencia artificial",
];

export interface FindCompetitorsOptions {
  center?: LatLng | null;
  radiusKm?: number;
}

/**
 * Finds real AI/marketing competitors in the zone via Places text search.
 * When a center + radius is provided, the search is location-biased and
 * results verifiably outside the radius are dropped.
 * Returns up to MAX_COMPETITORS unique entries (name, website, rating).
 */
export async function findCompetitors(zone: string, opts?: FindCompetitorsOptions): Promise<Competitor[]> {
  const seen = new Map<string, Competitor>();
  const center = opts?.center ?? null;
  const radiusKm = opts?.radiusKm;
  const searchOpts: TextSearchOptions | undefined = center && radiusKm
    ? { location: center, radiusMeters: radiusKm * 1000 }
    : undefined;

  for (const q of COMPETITOR_QUERIES) {
    if (seen.size >= MAX_COMPETITORS) break;
    const query = `${q} ${zone}`;
    let results;
    try {
      results = await textSearch(query, searchOpts);
    } catch {
      continue; // quota or network — skip this query
    }

    for (const place of results) {
      if (seen.size >= MAX_COMPETITORS) break;
      if (seen.has(place.place_id)) continue;

      // Strict radius filter: skip competitors verifiably outside the action radius
      if (center && radiusKm && place.geometry?.location) {
        if (haversineKm(center, place.geometry.location) > radiusKm) continue;
      }

      seen.set(place.place_id, {
        placeId: place.place_id,
        name: place.name,
        website: undefined,
        rating: place.rating,
      });
    }
  }

  const competitors = Array.from(seen.values());

  // Resolve website via Place Details (best-effort, cached)
  for (const comp of competitors) {
    try {
      const details = await getPlaceDetails(comp.placeId);
      if (details?.website) comp.website = details.website;
    } catch {
      // quota or network — leave website undefined
    }
  }

  return competitors;
}

/**
 * Scrapes each competitor's homepage: extracts a contact email from the raw
 * HTML (mailto:/text patterns) and uses the LLM to summarize their services.
 * Modifies competitors in-place, returns the enriched list.
 */
async function enrichCompetitorsWithServices(competitors: Competitor[]): Promise<Competitor[]> {
  for (const comp of competitors) {
    if (!comp.website) continue;
    try {
      const html = await fetchHtml(comp.website, SCRAPE_TIMEOUT_MS);

      // Contact email from raw HTML (mailto: first, then plain-text patterns)
      const emails = extractEmails(html);
      if (emails.length > 0) comp.email = emails[0];

      const truncated = htmlToText(html).slice(0, MAX_SCRAPE_CHARS);
      if (!truncated) continue;

      const resp = await openai.chat.completions.create({
        model: STRONG_MODEL,
        messages: [
          {
            role: "system",
            content: "Eres un analista de mercado. Extrae de este texto una lista concisa de los servicios que ofrece la empresa (máximo 5, una frase corta cada uno). Responde SOLO con un array JSON de strings.",
          },
          { role: "user", content: truncated },
        ],
        temperature: 0.2,
      });

      const raw_resp = resp.choices[0]?.message?.content?.trim() ?? "[]";
      const cleaned = raw_resp.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      try {
        const services: string[] = JSON.parse(cleaned);
        comp.services = Array.isArray(services) ? services.slice(0, 5).join(", ") : cleaned.slice(0, 200);
      } catch {
        comp.services = cleaned.slice(0, 200);
      }
    } catch {
      // scrape or LLM failure — skip enrichment for this competitor
    }
  }
  return competitors;
}

/**
 * Builds the "Competidores y Cómo Superarlos" study section.
 * If no Places key available, returns a degraded section with a notice.
 */
export async function buildCompetitorSection(
  zone: string,
  inputs: MarketStudyInputs,
  hasPlacesKey: boolean
): Promise<StudySection> {
  const key = "competitors";
  const title = "Competidores y Cómo Superarlos";

  if (!hasPlacesKey) {
    return {
      key,
      title,
      markdown: `> **Aviso:** No se encontró GOOGLE_MAPS_API_KEY. El análisis de competidores requiere acceso a Google Places para obtener datos reales.\n\nConfigura la clave de API para obtener un análisis con competidores reales de la zona de ${inputs.zone}.`,
    };
  }

  // Anchor the search to the user's action radius
  const center = await geocodeZone(zone, inputs.postalCode);
  let competitors = await findCompetitors(zone, { center, radiusKm: inputs.radiusKm });

  if (competitors.length === 0) {
    return {
      key,
      title,
      markdown: `No se encontraron competidores de IA/marketing digital en un radio de ${inputs.radiusKm} km alrededor de **${zone}** mediante Google Places. Considera ampliar el radio de búsqueda o verificar manualmente.`,
    };
  }

  // Enrich with website services + contact email via scraping
  competitors = await enrichCompetitorsWithServices(competitors);

  // Build markdown table
  const rows = competitors.map((c) => {
    const rating = c.rating ? `${c.rating} ★` : "—";
    const web = c.website ? `[web](${c.website})` : "sin web";
    const email = c.email ? `[${c.email}](mailto:${c.email})` : "—";
    const services = c.services ?? "—";
    return `| ${c.name} | ${web} | ${email} | ${rating} | ${services} |`;
  });

  const tableMarkdown = [
    "| Competidor | Web | Email | Rating | Servicios detectados |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");

  // Use LLM to generate differentiation analysis
  const competitorSummary = competitors
    .map((c) => `- ${c.name}${c.services ? `: ${c.services}` : ""} (Rating: ${c.rating ?? "N/D"})`)
    .join("\n");

  let differentiationAnalysis = "";
  try {
    const resp = await openai.chat.completions.create({
      model: STRONG_MODEL,
      messages: [
        {
          role: "system",
          content: `Eres un consultor estratégico de IA. Dados estos competidores REALES detectados en un radio de ${inputs.radiusKm} km alrededor de ${zone}, genera un análisis breve (3-5 ideas concretas) sobre cómo diferenciarse y superarlos EN ESA ZONA. Cada idea debe ser accionable y específica para ${zone} (menciona la zona, sectores locales o debilidades concretas de los competidores listados). PROHIBIDO inventar competidores que no estén en la lista. PROHIBIDO el relleno genérico tipo "depende del mercado". Responde en markdown.`,
        },
        {
          role: "user",
          content: `Zona: ${zone} (radio de acción: ${inputs.radiusKm} km)\nSectores objetivo: ${inputs.targetSectors.join(", ")}\n\nCompetidores encontrados:\n${competitorSummary}\n\nGenera el análisis de diferenciación.`,
        },
      ],
      temperature: 0.4,
    });
    differentiationAnalysis = resp.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    differentiationAnalysis = "*(No se pudo generar análisis de diferenciación — regenerar sección)*";
  }

  const markdown = `## Competidores reales en un radio de ${inputs.radiusKm} km de ${zone}\n\n${tableMarkdown}\n\n## Cómo diferenciarse y superarlos\n\n${differentiationAnalysis}`;

  // Adjuntamos los competidores estructurados para que el front los pinte como tabla
  // (se guardan dentro del JSON de la sección → sin migración). El markdown queda como fallback.
  return { key, title, markdown, competitors };
}
