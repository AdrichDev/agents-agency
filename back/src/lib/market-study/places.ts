import { Prospect } from "./types";
import { SERVICE_CATALOG } from "@/lib/service-catalog";
import { analyzeWebsite, computeOpportunityScore } from "./website-analyzer";

const PLACES_API_BASE = "https://maps.googleapis.com/maps/api";
const MAX_RESULTS = 30;

// In-memory cache for Place Details (TTL 30 min)
const detailsCache = new Map<string, { data: PlaceDetails; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlaceSearchResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  rating?: number;
  geometry?: { location?: LatLng };
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

// ── Geocoding (zone → lat/lng) with cache ─────────────────────────────────

const geocodeCache = new Map<string, { data: LatLng | null; expiresAt: number }>();

/**
 * Geocodes a zone (city + optional postal code) to lat/lng.
 * Returns null on failure — callers degrade gracefully to unbiased search.
 */
export async function geocodeZone(zone: string, postalCode?: string): Promise<LatLng | null> {
  const address = postalCode ? `${zone} ${postalCode}` : zone;
  const cacheKey = address.toLowerCase();
  const now = Date.now();
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.data;

  try {
    const key = process.env.GOOGLE_MAPS_API_KEY!;
    const url = `${PLACES_API_BASE}/geocode/json?address=${encodeURIComponent(address)}&region=es&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as {
      status: string;
      results?: Array<{ geometry?: { location?: LatLng } }>;
    };
    const location = data.status === "OK" ? data.results?.[0]?.geometry?.location ?? null : null;
    geocodeCache.set(cacheKey, { data: location, expiresAt: now + CACHE_TTL_MS });
    return location;
  } catch {
    return null;
  }
}

/** Great-circle distance in km between two points (haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface TextSearchOptions {
  location?: LatLng;
  radiusMeters?: number;
}

export async function textSearch(query: string, opts?: TextSearchOptions): Promise<PlaceSearchResult[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY!;
  let url = `${PLACES_API_BASE}/place/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`;
  if (opts?.location) {
    url += `&location=${opts.location.lat},${opts.location.lng}`;
    if (opts.radiusMeters) url += `&radius=${Math.round(opts.radiusMeters)}`;
  }
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

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
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

export interface ProspectSearchOptions {
  radiusKm?: number;
  postalCode?: string;
}

export async function searchProspects(
  zone: string,
  sectors: string[],
  opts?: ProspectSearchOptions
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

  // Geocode the zone to bias and strictly filter results by the action radius
  const radiusKm = opts?.radiusKm;
  const center = radiusKm ? await geocodeZone(zone, opts?.postalCode) : null;
  const searchOpts: TextSearchOptions | undefined = center && radiusKm
    ? { location: center, radiusMeters: radiusKm * 1000 }
    : undefined;

  // Build query list: sector-specific + generic types
  const queries = [
    ...sectors.map((s) => `${s} en ${zone}`),
    ...GENERIC_TYPES.map((t) => `${t} en ${zone}`),
  ];

  for (const query of queries) {
    if (collected.size >= MAX_RESULTS) break;

    let results: PlaceSearchResult[];

    try {
      results = await textSearch(query, searchOpts);
    } catch (err) {
      partial = collected.size > 0;
      warning = err instanceof Error ? err.message : "Error en Places API";
      break;
    }

    for (const place of results) {
      if (collected.size >= MAX_RESULTS) break;
      if (collected.has(place.place_id)) continue; // dedup

      // Strict radius filter: drop places verifiably outside the action radius
      if (center && radiusKm && place.geometry?.location) {
        if (haversineKm(center, place.geometry.location) > radiusKm) continue;
      }

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
