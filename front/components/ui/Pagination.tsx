"use client";

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  /** Total item count, shown as "X resultados" when provided. */
  total?: number;
}

/**
 * Pagination control rendered below a table. Hidden when there is a single
 * page. Shows prev/next plus a compact window of page numbers around current.
 */
export function Pagination({ page, totalPages, onChange, total }: PaginationProps) {
  if (totalPages <= 1) return null;

  // Compact window: current ±1, always with first/last and ellipsis gaps.
  const pages: (number | "...")[] = [];
  const push = (p: number) => pages.push(p);
  const window = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  let prev = 0;
  for (let p = 1; p <= totalPages; p++) {
    if (!window.has(p)) continue;
    if (p - prev > 1) pages.push("...");
    push(p);
    prev = p;
  }

  return (
    <div className="flex items-center justify-between gap-4 px-2 py-3 text-sm">
      <span className="text-slate-500 text-xs">
        {total !== undefined ? `${total} resultado${total === 1 ? "" : "s"}` : null}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn-dark px-3 py-1.5 disabled:opacity-40"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
        >
          ←
        </button>
        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`gap-${i}`} className="px-2 text-slate-500">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={
                p === page
                  ? "btn-grad px-3 py-1.5"
                  : "btn-dark px-3 py-1.5"
              }
              onClick={() => onChange(p)}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          className="btn-dark px-3 py-1.5 disabled:opacity-40"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
        >
          →
        </button>
      </div>
    </div>
  );
}
