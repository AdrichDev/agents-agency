"use client";

import { Modal } from "@/components/ui/Modal";
import type { ProspectContact } from "./contactTypes";

/**
 * Modal de confirmación para añadir contactos seleccionados como clientes.
 * Extraído de la página sin cambios de UI.
 */
export default function ConvertConfirmModal({
  open,
  contacts,
  converting,
  onClose,
  onConfirm,
}: {
  open: boolean;
  contacts: ProspectContact[];
  converting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={converting}
      panelClassName="card w-full max-w-md p-6 max-h-[80vh] overflow-y-auto"
    >
      <h2 className="text-xl font-extrabold text-white mb-4">
        ¿Estás de acuerdo con agregar a cliente los siguientes contactos?
      </h2>
      <ul className="space-y-1.5 mb-6 max-h-[40vh] overflow-y-auto">
        {contacts.map((c) => (
          <li key={c.id} className="text-sm text-slate-300 flex items-center gap-2">
            <span className="font-mono text-xs text-neon-cyan">{c.codigo}</span>
            <span className="text-white font-medium">{c.name}</span>
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          disabled={converting}
          className="px-4 py-2 border border-edge text-slate-300 hover:text-white hover:bg-white/5 rounded-xl font-bold transition text-sm"
        >
          Cancelar
        </button>
        <button
          onClick={onConfirm}
          disabled={converting || contacts.length === 0}
          className="btn-grad px-6 py-2 text-sm disabled:opacity-50"
        >
          {converting ? "Añadiendo..." : "Aceptar"}
        </button>
      </div>
    </Modal>
  );
}
