import type { ReactNode } from "react";

export interface TableColumn {
  /** Header label. Empty string for an actions column with no caption. */
  header: ReactNode;
  align?: "left" | "center" | "right";
  /** Extra classes on the <th> (e.g. width caps). Optional. */
  headClassName?: string;
  /** When set, the header becomes a sort toggle that calls onSort with this key. */
  sortKey?: string;
  /** Current sort direction for this column ("asc"/"desc"), or null when inactive. */
  sortDir?: "asc" | "desc" | null;
  /** Invoked with sortKey when a sortable header is clicked. */
  onSort?: (key: string) => void;
}

interface TableProps {
  columns: TableColumn[];
  /** Tbody rows. Each page keeps its bespoke <tr>/<td> markup. */
  children: ReactNode;
  /** Horizontal cell padding token. clientes/facturación = "px-6", contactos = "px-5". */
  cellPad?: "px-5" | "px-6";
}

const ALIGN: Record<NonNullable<TableColumn["align"]>, string> = {
  left: "",
  center: " text-center",
  right: " text-right",
};

/**
 * Shared dark table shell: scroll wrapper, header row y tbody con divisores.
 * Mantiene exactamente las clases originales; las celdas las aporta cada página.
 */
export function Table({ columns, children, cellPad = "px-6" }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b border-edge bg-white/[0.02] text-slate-500 text-xs uppercase tracking-wider">
            {columns.map((col, i) => (
              <th
                key={i}
                className={`${cellPad} py-4 font-bold${col.align ? ALIGN[col.align] : ""}${
                  col.headClassName ? ` ${col.headClassName}` : ""
                }`}
              >
                {col.sortKey ? (
                  <button
                    type="button"
                    onClick={() => col.onSort?.(col.sortKey!)}
                    className={`inline-flex items-center gap-1 uppercase tracking-wider transition hover:text-slate-300 cursor-pointer ${
                      col.sortDir ? "underline text-slate-300" : ""
                    }`}
                  >
                    {col.header}
                    <span className="text-[9px] leading-none">
                      {col.sortDir === "asc" ? "▲" : col.sortDir === "desc" ? "▼" : "↕"}
                    </span>
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">{children}</tbody>
      </table>
    </div>
  );
}
