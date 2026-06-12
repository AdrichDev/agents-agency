// Prospect merge helpers for market studies

import type { Prospect } from "./types";

/**
 * Merge incoming prospects into existing ones by placeId.
 * - New placeIds are appended.
 * - Repeated placeIds get refreshed data but ALWAYS keep the existing
 *   status (contacted/discarded are never lost).
 */
export function mergeProspects(existing: Prospect[], incoming: Prospect[]): Prospect[] {
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

  return merged;
}
