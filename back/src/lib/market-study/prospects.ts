// Prospect merge helpers for market studies

import type { Prospect } from "./types";
import { haversineKm, type LatLng } from "./places";

export interface RadiusContext {
  center: LatLng;
  radiusKm: number;
}

/**
 * Recomputes distanceKm + outOfRadius for a prospect against the current study
 * center/radius. Prospects without stored coordinates keep outOfRadius undefined
 * (unknown) so we never purge legacy data we cannot verify.
 */
function tagRadius(p: Prospect, ctx?: RadiusContext): Prospect {
  if (!ctx || p.lat === undefined || p.lng === undefined) return p;
  const distanceKm = haversineKm(ctx.center, { lat: p.lat, lng: p.lng });
  return {
    ...p,
    distanceKm: Math.round(distanceKm * 10) / 10,
    outOfRadius: distanceKm > ctx.radiusKm,
  };
}

/**
 * Merge incoming prospects into existing ones by placeId.
 * - New placeIds are appended.
 * - Repeated placeIds get refreshed data but ALWAYS keep the existing
 *   status (contacted/discarded are never lost).
 * - When a radius context is provided, every prospect is re-tagged with its
 *   distance to the current center and whether it now falls outside the radius.
 */
export function mergeProspects(
  existing: Prospect[],
  incoming: Prospect[],
  ctx?: RadiusContext
): Prospect[] {
  const merged = [...existing];
  const indexById = new Map<string, number>(existing.map((p, i) => [p.placeId, i]));

  for (const prospect of incoming) {
    const idx = indexById.get(prospect.placeId);
    if (idx === undefined) {
      indexById.set(prospect.placeId, merged.length);
      merged.push(prospect);
    } else {
      merged[idx] = { ...prospect, status: merged[idx].status };
    }
  }

  return merged.map((p) => tagRadius(p, ctx));
}

/** Re-tag an existing prospect list against a (possibly new) radius context. */
export function retagProspects(prospects: Prospect[], ctx: RadiusContext): Prospect[] {
  return prospects.map((p) => tagRadius(p, ctx));
}

/**
 * Removes prospects that fall outside the current radius. Contacted prospects
 * are protected (kept) so no CRM-relevant data is lost by accident.
 * Prospects with unknown coordinates (legacy) are also kept.
 */
export function purgeOutOfRadius(prospects: Prospect[]): { kept: Prospect[]; removed: number } {
  const kept = prospects.filter((p) => !(p.outOfRadius === true && p.status !== "contacted"));
  return { kept, removed: prospects.length - kept.length };
}
