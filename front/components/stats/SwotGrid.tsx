"use client";

import type { StudySection } from "./studyTypes";
import SectionEditor from "./SectionEditor";

// Cuadrantes DAFO. Se detecta la categoría por palabras clave en la línea de encabezado.
const QUADRANTS = [
  { key: "fortalezas", label: "Fortalezas", match: ["fortalez", "strength"], cls: "border-emerald-500/30 bg-emerald-500/5", dot: "bg-emerald-400", title: "text-emerald-300" },
  { key: "debilidades", label: "Debilidades", match: ["debilidad", "weakness"], cls: "border-red-500/30 bg-red-500/5", dot: "bg-red-400", title: "text-red-300" },
  { key: "oportunidades", label: "Oportunidades", match: ["oportunidad", "opportunit"], cls: "border-sky-500/30 bg-sky-500/5", dot: "bg-sky-400", title: "text-sky-300" },
  { key: "amenazas", label: "Amenazas", match: ["amenaza", "threat"], cls: "border-amber-500/30 bg-amber-500/5", dot: "bg-amber-400", title: "text-amber-300" },
] as const;

function categoryOf(line: string): string | null {
  const low = line.toLowerCase();
  for (const q of QUADRANTS) if (q.match.some((m) => low.includes(m))) return q.key;
  return null;
}

/** Parsea el markdown del DAFO en 4 listas. Devuelve null si no encuentra al menos 3
 *  cuadrantes con contenido (entonces se muestra el markdown normal). */
function parseSwot(md: string): Record<string, string[]> | null {
  const buckets: Record<string, string[]> = {};
  let current: string | null = null;

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    // ¿Es una línea de encabezado de categoría? (## X, **X**, - **X**, "X:")
    const looksLikeLabel =
      /^#{1,6}\s/.test(line) || /^[-*+]?\s*\*\*/.test(line) || /:$/.test(line) || line.length < 40;
    const cat = looksLikeLabel ? categoryOf(line) : null;
    if (cat) {
      current = cat;
      if (!buckets[cat]) buckets[cat] = [];
      continue;
    }

    if (current) {
      const item = line
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/\*\*/g, "")
        .trim();
      if (item) buckets[current].push(item);
    }
  }

  const withContent = QUADRANTS.filter((q) => (buckets[q.key]?.length ?? 0) > 0);
  return withContent.length >= 3 ? buckets : null;
}

export default function SwotGrid({
  section,
  studyId,
  onUpdate,
}: {
  section: StudySection;
  studyId: string;
  onUpdate: (key: string, markdown: string) => void;
}) {
  const parsed = parseSwot(section.markdown);

  // Sin estructura reconocible → markdown normal (editable), ya legible con prose-dark.
  if (!parsed) {
    return <SectionEditor section={section} studyId={studyId} onUpdate={onUpdate} />;
  }

  return (
    <div className="card p-5">
      <h3 className="text-base font-semibold text-slate-100 mb-4">{section.title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {QUADRANTS.map((q) => {
          const items = parsed[q.key] ?? [];
          return (
            <div key={q.key} className={`rounded-xl border p-4 ${q.cls}`}>
              <div className="flex items-center gap-2 mb-2.5">
                <span className={`h-2 w-2 rounded-full ${q.dot}`} />
                <h4 className={`text-sm font-bold ${q.title}`}>{q.label}</h4>
              </div>
              {items.length > 0 ? (
                <ul className="space-y-1.5">
                  {items.map((it, i) => (
                    <li key={i} className="text-xs text-slate-300 leading-relaxed flex gap-2">
                      <span className="text-slate-600 select-none">·</span>
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500 italic">Sin elementos.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
