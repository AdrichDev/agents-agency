"use client";

import { renderMarkdown } from "@/lib/markdown";
import type { StudySection } from "./studyTypes";

/**
 * Tabla de competidores (estética de prospectos). Usa los competidores estructurados
 * (section.competitors) si existen; el análisis de diferenciación se extrae del markdown.
 */
export default function CompetitorsTable({ section }: { section: StudySection }) {
  const competitors = [...(section.competitors ?? [])].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "", "es", { sensitivity: "base" })
  );

  // El markdown trae "## Competidores…" (tabla) + "## Cómo diferenciarse…" (análisis).
  // Tomamos solo la parte del análisis para no duplicar la tabla.
  const analysis = section.markdown.split(/##\s*Cómo diferenciarse[^\n]*/i)[1]?.trim();

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-base font-semibold text-slate-100">{section.title}</h3>
        <span className="text-xs text-slate-500">{competitors.length} competidores</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-white/10">
              <th className="py-2 pr-3">Competidor</th>
              <th className="py-2 pr-3">Rating</th>
              <th className="py-2 pr-3">Web</th>
              <th className="py-2 pr-3">Email</th>
              <th className="py-2">Servicios detectados</th>
            </tr>
          </thead>
          <tbody>
            {competitors.map((c) => (
              <tr key={c.placeId} className="border-b border-white/5 align-top">
                <td className="py-2 pr-3 font-medium text-slate-200">{c.name}</td>
                <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                  {c.rating != null ? `${c.rating} ★` : "—"}
                </td>
                <td className="py-2 pr-3">
                  {c.website ? (
                    <a
                      href={c.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-300 hover:text-violet-200 underline decoration-violet-500/40"
                    >
                      web
                    </a>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {c.email ? (
                    <a
                      href={`mailto:${c.email}`}
                      className="text-violet-300 hover:text-violet-200 underline decoration-violet-500/40 break-all"
                    >
                      {c.email}
                    </a>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="py-2 text-slate-400 text-xs max-w-[280px]">{c.services ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {analysis && (
        <div>
          <h4 className="text-sm font-semibold text-slate-300 mb-1.5">Cómo diferenciarse y superarlos</h4>
          <div className="prose-dark text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(analysis) }} />
        </div>
      )}
    </div>
  );
}
