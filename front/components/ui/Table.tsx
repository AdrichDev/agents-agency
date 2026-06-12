import type { ReactNode } from "react";

export interface TableColumn {
  /** Header label. Empty string for an actions column with no caption. */
  header: ReactNode;
  align?: "left" | "center" | "right";
  /** Extra classes on the <th> (e.g. width caps). Optional. */
  headClassName?: string;
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
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">{children}</tbody>
      </table>
    </div>
  );
}
