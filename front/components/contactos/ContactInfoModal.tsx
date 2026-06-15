"use client";

import { Modal } from "@/components/ui/Modal";
import { CONTACTADO_LABELS, formatDateTime, type ProspectContact } from "./contactTypes";

export default function ContactInfoModal({
  info,
  onClose,
}: {
  info: ProspectContact | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!info}
      onClose={onClose}
      panelClassName="card w-full max-w-md p-6 max-h-[80vh] overflow-y-auto relative"
    >
      {info && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-extrabold text-white">Información del contacto</h2>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="w-8 h-8 grid place-items-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-transform duration-200 hover:rotate-90"
            >
              <span className="text-xl leading-none">✕</span>
            </button>
          </div>
          <dl className="divide-y divide-edge text-sm">
            {[
              ["Código", info.codigo],
              ["Nombre", info.name],
              ["Tipo", info.type === "lead" ? "Lead" : "Prospecto"],
              ["Teléfono", info.phone || "—"],
              ["Email", info.email || "—"],
              ["Sector", info.sector || "—"],
              ["Dirección", info.direccion || "—"],
              ["Contactado", CONTACTADO_LABELS[info.contactado] ?? CONTACTADO_LABELS.nc],
              ["Fecha de alta", formatDateTime(info.createdAt)],
              ["Petición", info.peticion || "—"],
            ].map(([label, value]) => (
              <div key={label} className="py-2 grid grid-cols-[96px_1fr] gap-3">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-neon-cyan">
                  {label}
                </dt>
                <dd className="text-slate-300 break-words whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Modal>
  );
}
