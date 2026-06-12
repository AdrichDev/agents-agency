import { Prospect } from "./types";
import { SERVICE_CATALOG } from "@/lib/service-catalog";
import { analyzeWebsite, computeOpportunityScore } from "./website-analyzer";

const PLACES_API_BASE = "https://maps.googleapis.com/maps/api";
const MAX_RESULTS = 30;

// In-memory cache for Place Details (TTL 30 min)
const detailsCache = new Map<string, { data: PlaceDetails; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

interface PlaceSearchResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  rating?: number;
}

export interface PlaceDetails {
  place_id: string;
  name: string;
  formatted_address?: string;
  formatted_phone_number?: string;
  rating?: number;
  website?: string;
}

export function isConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

export async function textSearch(query: string): Promise<PlaceSearchResult[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY!;
  const url = `${PLACES_API_BASE}/place/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places Text Search HTTP ${res.status}: ${body.substring(0, 200)}`);
  }
  const data = await res.json() as { status: string; results?: PlaceSearchResult[]; error_message?: string };
  if (data.status === "OVER_QUERY_LIMIT" || data.status === "REQUEST_DENIED") {
    throw new Error(`Places API error: ${data.status} — ${data.error_message ?? ""}`);
  }
  return data.results ?? [];
}

async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const now = Date.now();
  const cached = detailsCache.get(placeId);
  if (cached && cached.expiresAt > now) return cached.data;

  const key = process.env.GOOGLE_MAPS_API_KEY!;
  const fields = "place_id,name,formatted_address,formatted_phone_number,rating,website";
  const url = `${PLACES_API_BASE}/place/details/json?place_id=${placeId}&fields=${fields}&key=${key}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json() as { status: string; result?: PlaceDetails };
  if (data.status !== "OK" || !data.result) return null;

  detailsCache.set(placeId, { data: data.result, expiresAt: now + CACHE_TTL_MS });
  return data.result;
}

function candidateServicesForSector(sector: string): string[] {
  // Map sector keywords to candidate service names
  const lower = sector.toLowerCase();
  const names: string[] = [];

  if (lower.includes("restaur") || lower.includes("hostel") || lower.includes("hotel") || lower.includes("bar")) {
    names.push(SERVICE_CATALOG.find((s) => s.id === "chatbot_basic")?.name ?? "");
    names.push(SERVICE_CATALOG.find((s) => s.id === "web_chatbot")?.name ?? "");
  }
  if (lower.includes("tienda") || lower.includes("retail") || lower.includes("comercio")) {
    names.push(SERVICE_CATALOG.find((s) => s.id === "chatbot_pro")?.name ?? "");
    names.push(SERVICE_CATALOG.find((s) => s.id === "web_basic")?.name ?? "");
  }
  if (names.length === 0) {
    // Default: basic chatbot + web
    names.push(SERVICE_CATALOG.find((s) => s.id === "chatbot_basic")?.name ?? "");
    names.push(SERVICE_CATALOG.find((s) => s.id === "web_basic")?.name ?? "");
  }

  return names.filter(Boolean);
}

export interface ProspectSearchResult {
  prospects: Prospect[];
  partial: boolean;
  warning?: string;
}

// Fallback generic types added alongside sector-specific queries
const GENERIC_TYPES = ["store", "establishment"];

export async function searchProspects(
  zone: string,
  sectors: string[]
): Promise<ProspectSearchResult> {
  if (!isConfigured()) {
    return {
      prospects: [],
      partial: false,
      warning: "Requiere GOOGLE_MAPS_API_KEY para activar prospección",
    };
  }

  const collected = new Map<string, Prospect>(); // keyed by placeId
  let partial = false;
  let warning: string | undefined;

  // Build query list: sector-specific + generic types
  const queries = [
    ...sectors.map((s) => `${s} en ${zone}`),
    ...GENERIC_TYPES.map((t) => `${t} en ${zone}`),
  ];

  for (const query of queries) {
    if (collected.size >= MAX_RESULTS) break;

    let results: PlaceSearchResult[];

    try {
      results = await textSearch(query);
    } catch (err) {
      partial = collected.size > 0;
      warning = err instanceof Error ? err.message : "Error en Places API";
      break;
    }

    for (const place of results) {
      if (collected.size >= MAX_RESULTS) break;
      if (collected.has(place.place_id)) continue; // dedup

      let details: PlaceDetails | null = null;
      try {
        details = await getPlaceDetails(place.place_id);
      } catch {
        // quota or network — save what we have
        partial = true;
        warning = "Cuota de Places API alcanzada — resultados parciales";
        break;
      }

      if (!details) continue;

      const hasWebsite = !!(details.website && details.website.trim() !== "");
      const sector = sectors.find((s) => query.startsWith(s)) ?? "general";

      if (hasWebsite) {
        // Analyze website for chatbot presence
        const analysis = await analyzeWebsite(details.website!);
        const opportunityScore = computeOpportunityScore(
          analysis.websiteStatus,
          !!analysis.unverified,
          details.rating
        );

        collected.set(place.place_id, {
          placeId: place.place_id,
          name: details.name,
          address: details.formatted_address,
          phone: details.formatted_phone_number,
          rating: details.rating,
          sector,
          candidateServices: candidateServicesForSector(sector),
          status: "new",
          websiteStatus: analysis.websiteStatus,
          websiteUrl: details.website,
          opportunityScore,
          unverified: analysis.unverified,
        });
      } else {
        // No website
        const opportunityScore = computeOpportunityScore("no_web", false, details.rating);
        collected.set(place.place_id, {
          placeId: place.place_id,
          name: details.name,
          address: details.formatted_address,
          phone: details.formatted_phone_number,
          rating: details.rating,
          sector,
          candidateServices: candidateServicesForSector(sector),
          status: "new",
          websiteStatus: "no_web",
          opportunityScore,
        });
      }
    }
  }

  return {
    prospects: Array.from(collected.values()),
    partial,
    warning,
  };
}
