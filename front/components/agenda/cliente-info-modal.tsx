"use client";

import type { DemoAppointment } from "@/components/agenda/agenda-fullscreen";

/**
 * Ficha de cliente estilo OperaOS (creador_CRM ClienteInfoModal). AA no tiene
 * entidad Cliente ni GET /customers/:id: todo el contenido sale de datos que ya
 * viajan con la cita (`contactSummary` resuelto por el back vía Tenant/
 * ProspectContact, más `email`/`phone` propios de la cita). Cero fetch nuevo.
 */

const dtCls = "text-[11px] font-bold uppercase tracking-wider text-[var(--accent-1)]";

export function ClienteInfoModal({
  appointment,
  onClose,
}: {
  appointment: DemoAppointment;
  onClose: () => void;
}) {
  const summary = appointment.contactSummary;

  const campos: [string, string][] = [
    ["Nombre comercial", summary?.commercialName || appointment.client || "—"],
    ["Persona de contacto", summary?.contactPerson || "—"],
    ["Teléfono", summary?.phone || appointment.phone || "—"],
    ["Email", appointment.email || "—"],
    ["Dirección", summary?.address || "—"],
  ];

  return (
    <div className="opera-modal-backdrop" data-testid="agenda-cliente-modal" onClick={onClose}>
      <div className="opera-modal" onClick={(e) => e.stopPropagation()}>
        <div className="opera-modal-header">
          <h3 className="opera-modal-title">Ficha de cliente</h3>
          <button
            type="button"
            className="opera-modal-close"
            onClick={onClose}
            data-testid="modal-close-button"
            aria-label="Cerrar modal"
          >
            ×
          </button>
        </div>

        <div className="opera-modal-body">
          <dl className="divide-y divide-[rgba(255,255,255,0.1)] text-sm">
            {campos.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[110px_1fr] gap-3 py-2">
                <dt className={dtCls}>{label}</dt>
                <dd className="break-words whitespace-pre-wrap text-white">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="opera-modal-foot">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
