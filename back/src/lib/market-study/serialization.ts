/**
 * serialization.ts — Parsing of persisted study fields and CSV export.
 * Pure helpers: no I/O, no Prisma. Extracted from routes/market-studies.ts.
 */

import type { StudySection, Prospect } from "./types";

/** Coerce a persisted `sections` value (array | JSON string | other) into a StudySection[]. */
export function parseSections(raw: unknown): StudySection[] {
  if (Array.isArray(raw)) return raw as StudySection[];
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

/** Coerce a persisted `prospects` value (array | JSON string | other) into a Prospect[]. */
export function parseProspects(raw: unknown): Prospect[] {
  if (Array.isArray(raw)) return raw as Prospect[];
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

function escapeCSV(v: string | number | undefined | null): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Render a prospects list as CSV (no BOM; the caller adds it for Excel). */
export function toCSV(prospects: Prospect[]): string {
  const header = "name,address,phone,rating,sector,placeId,status,websiteStatus,opportunityScore,distanceKm,outOfRadius";
  const rows = prospects.map((p) =>
    [p.name, p.address, p.phone, p.rating, p.sector, p.placeId, p.status, p.websiteStatus ?? "", p.opportunityScore ?? "", p.distanceKm ?? "", p.outOfRadius ? "sí" : ""].map(escapeCSV).join(",")
  );
  return [header, ...rows].join("\n");
}
