"use client";

import { useState } from "react";
import StarRating from "@/components/stats/StarRating";
import { renderMarkdown } from "@/lib/markdown";
import type { StudySection } from "./studyTypes";
import SectionEditor from "./SectionEditor";

interface RecommendedOption {
  title: string;
  description: string;
  successScore: number;
  rationale: string;
}

function parseRecommendedOptions(markdown: string): RecommendedOption[] | null {
  // Try to extract a JSON array from a ```json fence or bare JSON array in the markdown
  const fenceMatch = markdown.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  const bareMatch = markdown.match(/(\[[\s\S]*"successScore"[\s\S]*?\])/);
  const raw = fenceMatch?.[1] ?? bareMatch?.[1];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (o: any) => typeof o?.title === "string" && typeof o?.successScore === "number"
    );
  } catch {
    return null;
  }
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
  const [open, setOpen] = useState(false);
  const options = parseRecommendedOptions(section.markdown);

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((x) => !x)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/2"
      >
        <span className="font-semibold text-white">{section.title}</span>
        <span className="text-slate-500 text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-white/5 p-4 space-y-3">
          {options && options.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {options.map((opt, i) => (
                <div key={i} className="card p-4 border border-white/5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white text-sm">{opt.title}</span>
                    <StarRating value={opt.successScore} size="sm" />
                  </div>
                  <p className="text-slate-400 text-xs">{opt.description}</p>
                  {opt.rationale && (
                    <p className="text-slate-500 text-xs italic">Justificación: {opt.rationale}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            // Fallback: raw markdown render
            <div
              className="prose-dark text-sm"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(section.markdown) }}
            />
          )}
          {/* Always allow editing the raw markdown */}
          <details className="mt-2">
            <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300">
              Editar contenido raw
            </summary>
            <SectionEditor section={section} studyId={studyId} onUpdate={onUpdate} embedded />
          </details>
        </div>
      )}
    </div>
  );
}
