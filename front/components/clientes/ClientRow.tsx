"use client";

import { Pencil, Trash2 } from "lucide-react";
import { TOKENS_PER_MESSAGE, type ClientRecord } from "./types";

function InvoiceIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  );
}

interface ClientRowProps {
  client: ClientRecord;
  onEdit: (c: ClientRecord) => void;
  onDelete: (c: ClientRecord) => void;
  onOpenInvoices: (c: ClientRecord) => void;
}

/** Fila de la tabla de clientes: datos, créditos IA y acciones. */
export function ClientRow({ client: c, onEdit, onDelete, onOpenInvoices }: ClientRowProps) {
  const remaining = Math.max(0, (c.tokenBalance ?? 0) - (c.tokensUsed ?? 0));
  const msgs = Math.floor(remaining / TOKENS_PER_MESSAGE);
  const blocked = !c.isActive || remaining <= 0;

  return (
    <tr className="hover:bg-white/[0.02] transition">
      <td className="px-6 py-4 font-mono text-xs text-neon-cyan font-bold">
        {c.codCliente || "—"}
      </td>
      <td className="px-6 py-4 text-white font-medium">{c.name}</td>
      <td className="px-6 py-4 text-slate-300">{c.contactPerson || "—"}</td>
      <td className="px-6 py-4 text-slate-400">{c.phone || "—"}</td>
      <td className="px-6 py-4 text-slate-400">{c.email || "—"}</td>
      <td className="px-6 py-4 text-center">
        <div className="inline-flex flex-col items-center leading-tight">
          <span
            className={`font-mono text-xs font-bold ${
              blocked ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {remaining.toLocaleString("es")} tok
          </span>
          <span className="text-[10px] text-slate-500">
            ~{msgs.toLocaleString("es")} msgs
          </span>
          {blocked && (
            <span className="text-[10px] text-red-400 font-bold">BLOQUEADO</span>
          )}
        </div>
      </td>
      <td className="px-6 py-4 text-center">
        <button
          onClick={() => onOpenInvoices(c)}
          title={
            c.hasInvoices
              ? "Ver facturas del cliente"
              : "Sin facturas — ir a facturación"
          }
          className={`inline-grid place-items-center w-9 h-9 rounded-xl border transition ${
            c.hasInvoices
              ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.25)]"
              : "text-red-400 border-red-500/40 bg-red-500/10 hover:bg-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.25)]"
          }`}
        >
          <InvoiceIcon />
        </button>
      </td>
      <td className="px-6 py-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onEdit(c)}
            title="Editar"
            aria-label="Editar"
            className="icon-btn icon-btn-edit"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(c)}
            title="Eliminar"
            aria-label="Eliminar"
            className="icon-btn icon-btn-delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
