"use client";

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  /** Page size, shown as "N por página". Defaults to 10. */
  pageSize?: number;
  /** Accepted for backward compatibility; not displayed. */
  total?: number;
}

/**
 * Typical prev/next pagination, matching the Skills Marketplace nav:
 * "Página X de Y - N por página" + Anterior/Siguiente. Hidden on a single page.
 */
export function Pagination({ page, totalPages, onChange, pageSize = 10 }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-4 text-sm text-slate-400">
      <span>
        Página {page} de {totalPages} - {pageSize} por página
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-dark"
          disabled={page <= 1}
          onClick={() => onChange(Math.max(1, page - 1))}
        >
          Anterior
        </button>
        <button
          type="button"
          className="btn-dark"
          disabled={page >= totalPages}
          onClick={() => onChange(Math.min(totalPages, page + 1))}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
