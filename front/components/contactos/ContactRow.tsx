"use client";

import { Badge, badgeVariantClass } from "@/components/ui/Badge";
import { Info, Pencil, Trash2 } from "lucide-react";
import {
  CONTACTADO_LABELS,
  formatDateTime,
  isToday,
  type ProspectContact,
} from "./contactTypes";

export default function ContactRow({
  c,
  selectionMode,
  selected,
  onToggleSelect,
  onCycleContactado,
  onInfo,
  onEdit,
  onDelete,
}: {
  c: ProspectContact;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onCycleContactado: (c: ProspectContact) => void;
  onInfo: (c: ProspectContact) => void;
  onEdit: (c: ProspectContact) => void;
  onDelete: (c: ProspectContact) => void;
}) {
  const contactadoStyle = badgeVariantClass(c.contactado);
  const isNewToday = c.contactado !== "si" && isToday(c.createdAt);
  return (
    <tr key={c.id} className="hover:bg-white/[0.02] transition">
      {selectionMode && (
        <td className="px-5 py-4 text-center">
          <input
            type="checkbox"
            className="accent-indigo-500 w-4 h-4 cursor-pointer"
            checked={selected}
            onChange={() => onToggleSelect(c.id)}
          />
        </td>
      )}
      <td className="px-5 py-4 font-mono text-xs text-neon-cyan font-bold">
        {c.codigo}
      </td>
      <td className="px-5 py-4">
        <Badge
          variant={c.type}
          className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border"
        >
          {c.type === "lead" ? "Lead" : "Prospecto"}
        </Badge>
      </td>
      <td className="px-5 py-4 text-white font-medium">
        <span className="inline-flex items-center gap-2">
          {c.name}
          {isNewToday && (
            <span
              title="Nuevo hoy — pendiente de contactar"
              className="w-[18px] h-[18px] rounded-full bg-yellow-400 text-black text-[10px] font-black grid place-items-center leading-none shadow-[0_0_8px_rgba(250,204,21,0.6)]"
            >
              N
            </span>
          )}
        </span>
      </td>
      <td className="px-5 py-4 text-slate-400">{c.phone || "—"}</td>
      <td className="px-5 py-4 text-slate-400">{c.email || "—"}</td>
      <td className="px-5 py-4 text-slate-400">{c.sector || "—"}</td>
      <td className="px-5 py-4 text-center">
        <button
          onClick={() => onCycleContactado(c)}
          title="Clic para cambiar el estado (Sí → No → NC)"
          className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border transition hover:opacity-80 cursor-pointer ${contactadoStyle}`}
        >
          {CONTACTADO_LABELS[c.contactado] ?? CONTACTADO_LABELS.nc}
        </button>
      </td>
      <td className="px-5 py-4 text-slate-400 tabular-nums">
        {formatDateTime(c.createdAt)}
      </td>
      <td className="px-5 py-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onInfo(c)}
            title="Ver información"
            aria-label="Ver información"
            className="icon-btn icon-btn-info"
          >
            <Info className="w-4 h-4" />
          </button>
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
