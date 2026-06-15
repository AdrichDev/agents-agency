import { useEffect, useMemo, useState } from "react";

export interface Pagination<T> {
  /** Items of the current page (≤ pageSize). */
  pageItems: T[];
  /** 1-based current page. */
  page: number;
  setPage: (p: number) => void;
  /** Total number of pages (≥ 1). */
  totalPages: number;
  /** Total item count across all pages. */
  total: number;
  pageSize: number;
}

/**
 * Client-side pagination over an in-memory array. Default 10 items/page.
 * Clamps the page when the underlying list shrinks (e.g. after a delete or a
 * filter change) so the view never lands on an empty out-of-range page.
 */
export function usePagination<T>(items: T[], pageSize = 10): Pagination<T> {
  const [page, setPage] = useState(1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return { pageItems, page, setPage, totalPages, total, pageSize };
}
