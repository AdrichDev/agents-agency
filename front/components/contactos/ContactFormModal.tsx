"use client";

import { Modal } from "@/components/ui/Modal";
import type { ContactFormState, ContactType } from "./contactTypes";

export default function ContactFormModal({
  open,
  onClose,
  editingId,
  form,
  setForm,
  saving,
  formError,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  editingId: string | null;
  form: ContactFormState;
  setForm: (f: ContactFormState) => void;
  saving: boolean;
  formError: string;
  onSave: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} closeDisabled={saving}>
      <h2 className="text-xl font-extrabold text-white mb-5">
        {editingId ? "Editar contacto" : "Nuevo contacto"}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Tipo</label>
          <select
            className="input-dark"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as ContactType })}
          >
            <option value="prospecto">Prospecto</option>
            <option value="lead">Lead</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Nombre *</label>
          <input
            className="input-dark"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Teléfono</label>
          <input
            type="tel"
            className="input-dark"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Email</label>
          <input
            type="email"
            className="input-dark"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Sector</label>
          <input
            className="input-dark"
            value={form.sector}
            onChange={(e) => setForm({ ...form, sector: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Dirección</label>
          <input
            className="input-dark"
            value={form.direccion}
            onChange={(e) => setForm({ ...form, direccion: e.target.value })}
          />
        </div>
      </div>

      {formError && <p className="text-sm text-red-400 mt-4">{formError}</p>}

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
          {saving ? "Guardando..." : editingId ? "Guardar cambios" : "Crear contacto"}
        </button>
      </div>
    </Modal>
  );
}
