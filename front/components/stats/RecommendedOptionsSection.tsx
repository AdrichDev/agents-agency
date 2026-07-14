"use client";

import StarRating from "@/components/stats/StarRating";
import { renderMarkdown } from "@/lib/markdown";
import type { StudySection, RecommendedOption } from "./studyTypes";
import SectionEditor from "./SectionEditor";

// Fallback para estudios antiguos: intenta extraer las opciones de un JSON embebido en el
// markdown. Los nuevos estudios ya traen section.options estructurado.
function parseFromMarkdown(markdown: string): RecommendedOption[] | null {
  const fenceMatch = markdown.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  const bareMatch = markdown.match(/(\[[\s\S]*"successScore"[\s\S]*?\])/);
  const raw = fenceMatch?.[1] ?? bareMatch?.[1];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (o: unknown): o is RecommendedOption =>
        typeof (o as RecommendedOption)?.title === "string" &&
        typeof (o as RecommendedOption)?.successScore === "number"
    );
  } catch {
    return null;
  }
}

function Meta({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="rounded-lg bg-white/5 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xs text-slate-300 mt-0.5">{value}</div>
    </div>
  );
}

export default function RecommendedOptionsSection({
  section,
  studyId,
  onUpdate,
}: {
  section: StudySection;
  studyId: string;
  onUpdate: (key: string, markdown: string) => void;
}) {
  const options =
    section.options && section.options.length > 0
      ? section.options
      : parseFromMarkdown(section.markdown);

  // Intro = markdown sin el bloque JSON (si lo llevara embebido).
  const intro = section.markdown
    .replace(/```(?:json)?\s*\[[\s\S]*?\]\s*```/g, "")
    .replace(/\[[\s\S]*"successScore"[\s\S]*?\]/g, "")
    .trim();

  return (
    <div className="card p-5 space-y-4">
      <h3 className="text-base font-semibold text-slate-100">{section.title}</h3>

      {intro.length > 4 && (
        <div className="prose-dark text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(intro) }} />
      )}

      {options && options.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {options.map((opt, i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-white text-sm leading-snug">{opt.title}</span>
                <StarRating value={opt.successScore} size="sm" />
              </div>
              <p className="text-slate-300 text-xs leading-relaxed">{opt.description}</p>
              {(opt.investment || opt.effort || opt.impact) && (
                <div className="grid grid-cols-3 gap-2">
                  <Meta label="Inversión" value={opt.investment} />
                  <Meta label="Esfuerzo" value={opt.effort} />
                  <Meta label="Impacto" value={opt.impact} />
                </div>
              )}
              {opt.firstStep && (
                <p className="text-xs">
                  <span className="text-violet-300 font-medium">Primer paso: </span>
                  <span className="text-slate-300">{opt.firstStep}</span>
                </p>
              )}
              {opt.rationale && (
                <p className="text-slate-500 text-[11px] italic border-t border-white/5 pt-2">{opt.rationale}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="prose-dark text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(section.markdown) }} />
      )}

      <details className="mt-1">
        <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300">Editar contenido raw</summary>
        <SectionEditor section={section} studyId={studyId} onUpdate={onUpdate} embedded />
      </details>
    </div>
  );
}
