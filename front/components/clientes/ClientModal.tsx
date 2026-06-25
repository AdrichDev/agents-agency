"use client";

import { Modal } from "@/components/ui/Modal";
import { TOKENS_PER_MESSAGE, formatThousands, type ClientFormState } from "./types";

interface ClientModalProps {
  open: boolean;
  editingId: string | null;
  form: ClientFormState;
  saving: boolean;
  formError: string;
  onChange: (form: ClientFormState) => void;
  onClose: () => void;
  onSave: () => void;
}

/** Modal de alta / edición de cliente, incluido el bloque de créditos de IA. */
export function ClientModal({
  open,
  editingId,
  form,
  saving,
  formError,
  onChange,
  onClose,
  onSave,
}: ClientModalProps) {
  return (
    <Modal open={open} onClose={onClose} closeDisabled={saving}>
      <h2 className="text-xl font-extrabold text-white mb-5">
        {editingId ? "Editar cliente" : "Nuevo cliente"}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Nombre comercial *</label>
          <input
            className="input-dark"
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Razón social</label>
          <input
            className="input-dark"
            value={form.razonSocial}
            onChange={(e) => onChange({ ...form, razonSocial: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">NIF / CIF</label>
          <input
            className="input-dark"
            value={form.cif}
            onChange={(e) => onChange({ ...form, cif: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Persona de contacto</label>
          <input
            className="input-dark"
            value={form.contactPerson}
            onChange={(e) => onChange({ ...form, contactPerson: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Teléfono</label>
          <input
            type="tel"
            className="input-dark"
            value={form.phone}
            onChange={(e) => onChange({ ...form, phone: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Email</label>
          <input
            type="email"
            className="input-dark"
            value={form.email}
            onChange={(e) => onChange({ ...form, email: e.target.value })}
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs text-slate-400 mb-1.5">Dirección</label>
          <input
            className="input-dark"
            value={form.direccion}
            onChange={(e) => onChange({ ...form, direccion: e.target.value })}
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs text-slate-400 mb-1.5">Sector</label>
          <input
            className="input-dark"
            value={form.sector}
            onChange={(e) => onChange({ ...form, sector: e.target.value })}
          />
        </div>

        {/* Créditos de IA: cupo de tokens del widget del cliente */}
        <div className="md:col-span-2 border-t border-edge pt-4 mt-1">
          <label className="block text-xs text-slate-400 mb-1.5">
            Tokens IA
          </label>
          <input
            type="text"
            inputMode="numeric"
            className="input-dark"
            value={formatThousands(form.tokenBalance)}
            onChange={(e) =>
              onChange({ ...form, tokenBalance: e.target.value.replace(/\D/g, "") })
            }
          />
          <p className="text-[11px] text-slate-500 mt-1">
            ~{Math.floor((parseInt(form.tokenBalance, 10) || 0) / TOKENS_PER_MESSAGE).toLocaleString("es")} mensajes estimados ({TOKENS_PER_MESSAGE.toLocaleString("es")} tok/msg FAQ/reservas).
          </p>
          <label className="flex items-center gap-2 mt-3 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => onChange({ ...form, isActive: e.target.checked })}
            />
            Asistente activo (desmarcar bloquea el widget)
          </label>
        </div>
      </div>

      {formError && (
        <p className="text-sm text-red-400 mt-4">{formError}</p>
      )}

      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 border border-edge text-slate-300 hover:text-white hover:bg-white/5 rounded-xl font-bold transition text-sm"
        >
          Cancelar
        </button>
        <button
          onClick={onSave}
          disabled={saving || !form.name.trim()}
          className="btn-grad px-6 py-2 text-sm disabled:opacity-50"
        >
          {saving ? "Guardando..." : editingId ? "Guardar cambios" : "Crear cliente"}
        </button>
      </div>
    </Modal>
  );
}
