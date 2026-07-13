import { Prospect } from "./types";
import { SERVICE_CATALOG } from "@/lib/service-catalog";
import { analyzeWebsite, computeOpportunityScore } from "./website-analyzer";
import { logger } from "@/lib/logger";

// Legacy Geocoding API (still the recommended way to turn an address into lat/lng).
const GEOCODE_API_BASE = "https://maps.googleapis.com/maps/api";
// Places API (New) — single host for Text Search + Place Details.
const PLACES_NEW_BASE = "https://places.googleapis.com/v1";

const MAX_RESULTS = 30;
const MAX_PAGES_PER_QUERY = 2; // searchText returns up to 20/page → 2 pages ≈ 40 candidates
const PLACES_MAX_RADIUS_M = 50_000; // hard limit of locationRestriction.circle

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
  // Places API (New) returns these in the same call → callers can skip Place Details.
  website?: string;
  phone?: string;
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
 * Returns null on failure — callers MUST decide how to degrade (we no longer
 * fall back to an unbounded city-wide search, which was the cause of results
 * appearing many km outside the requested radius).
 */
export async function geocodeZone(zone: string, postalCode?: string): Promise<LatLng | null> {
  const address = postalCode ? `${zone} ${postalCode}` : zone;
  const cacheKey = address.toLowerCase();
  const now = Date.now();
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.data;

  try {
    const key = process.env.GOOGLE_MAPS_API_KEY!;
    const url = `${GEOCODE_API_BASE}/geocode/json?address=${encodeURIComponent(address)}&region=es&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn({ address, http: res.status }, "[places] geocode HTTP no-ok");
      return null;
    }
    const data = await res.json() as {
      status: string;
      error_message?: string;
      results?: Array<{ geometry?: { location?: LatLng } }>;
    };
    if (data.status !== "OK") {
      // Motivo REAL de Google (REQUEST_DENIED = API no habilitada / key restringida;
      // ZERO_RESULTS = zona inexistente; OVER_QUERY_LIMIT = cuota). Antes se tragaba y el
      // usuario veía "revisa la zona" aunque el fallo fuese de configuración de la key.
      logger.warn({ address, status: data.status, error: data.error_message }, "[places] geocode falló");
      return null;
    }
    const location = data.results?.[0]?.geometry?.location ?? null;
    // Only cache successful geocodes; transient failures should be retried.
    if (location) geocodeCache.set(cacheKey, { data: location, expiresAt: now + CACHE_TTL_MS });
    return location;
  } catch (err) {
    logger.warn({ address, err }, "[places] geocode error de red");
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

// ── Places API (New): Text Search with hard circular restriction ──────────

const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.businessStatus",
  "nextPageToken",
].join(",");

interface NewPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  businessStatus?: string;
}

function newPlaceToResult(p: NewPlace): PlaceSearchResult {
  return {
    place_id: p.id,
    name: p.displayName?.text ?? "(sin nombre)",
    formatted_address: p.formattedAddress,
    rating: p.rating,
    website: p.websiteUri,
    phone: p.nationalPhoneNumber,
    geometry: p.location
      ? { location: { lat: p.location.latitude, lng: p.location.longitude } }
      : undefined,
  };
}

export interface TextSearchOptions {
  location?: LatLng;
  radiusMeters?: number;
}

/**
 * Text Search via Places API (New). Con location + radius se sesga la búsqueda al círculo
 * con `locationBias.circle` (la API NO admite circle en locationRestriction → daba
 * INVALID_ARGUMENT). El radio exacto lo garantiza el filtro por haversine del caller
 * (searchProspects / competitors), que dispone de la ubicación precisa de Place Details.
 */
export async function textSearch(query: string, opts?: TextSearchOptions): Promise<PlaceSearchResult[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY!;
  const collected: PlaceSearchResult[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
    const body: Record<string, unknown> = {
      textQuery: query,
      languageCode: "es",
      regionCode: "ES",
      maxResultCount: 20,
    };
    if (opts?.location && opts.radiusMeters) {
      body.locationBias = {
        circle: {
          center: { latitude: opts.location.lat, longitude: opts.location.lng },
          radius: Math.min(Math.round(opts.radiusMeters), PLACES_MAX_RADIUS_M),
        },
      };
    }
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(`${PLACES_NEW_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      // Surface "API (New) not enabled" / permission problems clearly to callers.
      throw new Error(`Places API (New) HTTP ${res.status}: ${text.substring(0, 200)}`);
    }

    const data = await res.json() as { places?: NewPlace[]; nextPageToken?: string };
    for (const p of data.places ?? []) collected.push(newPlaceToResult(p));

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return collected;
}

const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "rating",
  "websiteUri",
].join(",");

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const now = Date.now();
  const cached = detailsCache.get(placeId);
  if (cached && cached.expiresAt > now) return cached.data;

  const key = process.env.GOOGLE_MAPS_API_KEY!;
  const res = await fetch(`${PLACES_NEW_BASE}/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK,
    },
  });
  if (!res.ok) return null;

  const p = await res.json() as NewPlace;
  if (!p?.id) return null;

  const details: PlaceDetails = {
    place_id: p.id,
    name: p.displayName?.text ?? "(sin nombre)",
    formatted_address: p.formattedAddress,
    formatted_phone_number: p.nationalPhoneNumber,
    rating: p.rating,
    website: p.websiteUri,
  };
  detailsCache.set(placeId, { data: details, expiresAt: now + CACHE_TTL_MS });
  return details;
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

  const radiusKm = opts?.radiusKm;

  // Hard requirement now: geolocate the zone so we can RESTRICT the search to the
  // action radius. Without a center we refuse the search instead of returning the
  // whole-city noise that produced results dozens of km away.
  const center = await geocodeZone(zone, opts?.postalCode);
  if (!center) {
    return {
      prospects: [],
      partial: false,
      warning: `No se pudo geolocalizar "${zone}"${opts?.postalCode ? ` (CP ${opts.postalCode})` : ""}. Revisa el nombre de la zona o el código postal para acotar la búsqueda.`,
    };
  }

  const effectiveRadiusKm = radiusKm && radiusKm > 0 ? radiusKm : 5;
  const searchOpts: TextSearchOptions = {
    location: center,
    radiusMeters: effectiveRadiusKm * 1000,
  };

  const collected = new Map<string, Prospect>(); // keyed by placeId
  let partial = false;
  let warning: string | undefined;

  // Sector-specific queries only (generic "store/establishment" queries were
  // removed — they polluted results with unrelated businesses).
  const queries = sectors.map((s) => `${s} en ${zone}`);

  for (const rawQuery of queries) {
    if (collected.size >= MAX_RESULTS) break;
    const sector = sectors.find((s) => rawQuery.startsWith(s)) ?? "general";

    let results: PlaceSearchResult[];
    try {
      results = await textSearch(rawQuery, searchOpts);
    } catch (err) {
      partial = collected.size > 0;
      warning = err instanceof Error ? err.message : "Error en Places API";
      break;
    }

    for (const place of results) {
      if (collected.size >= MAX_RESULTS) break;
      if (collected.has(place.place_id)) continue; // dedup

      // Belt-and-suspenders: drop anything without coordinates, or verifiably
      // outside the action radius (the New API hard-restricts, but we double-check).
      const loc = place.geometry?.location;
      if (!loc) continue;
      const distanceKm = haversineKm(center, loc);
      if (distanceKm > effectiveRadiusKm) continue;

      const hasWebsite = !!(place.website && place.website.trim() !== "");

      let websiteStatus: Prospect["websiteStatus"];
      let opportunityScore: number;
      let unverified: boolean | undefined;

      if (hasWebsite) {
        const analysis = await analyzeWebsite(place.website!);
        websiteStatus = analysis.websiteStatus;
        unverified = analysis.unverified;
        opportunityScore = computeOpportunityScore(analysis.websiteStatus, !!analysis.unverified, place.rating);
      } else {
        websiteStatus = "no_web";
        opportunityScore = computeOpportunityScore("no_web", false, place.rating);
      }

      collected.set(place.place_id, {
        placeId: place.place_id,
        name: place.name,
        address: place.formatted_address,
        phone: place.phone,
        rating: place.rating,
        sector,
        candidateServices: candidateServicesForSector(sector),
        status: "new",
        websiteStatus,
        websiteUrl: hasWebsite ? place.website : undefined,
        opportunityScore,
        unverified,
        lat: loc.lat,
        lng: loc.lng,
        distanceKm: Math.round(distanceKm * 10) / 10,
        outOfRadius: false,
      });
    }
  }

  return {
    prospects: Array.from(collected.values()),
    partial,
    warning,
  };
}
