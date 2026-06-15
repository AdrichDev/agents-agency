"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useResource } from "@/hooks/useResource";
import { Modal } from "@/components/ui/Modal";
import { Table } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { useDialogs } from "@/components/ui/ConfirmProvider";
import { usePagination } from "@/hooks/usePagination";

interface ClientRecord {
  id: string;
  codCliente: string | null;
  name: string;
  razonSocial: string | null;
  cif: string | null;
  direccion: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  contactPerson: string | null;
  sector: string | null;
  website: string | null;
  hasInvoices: boolean;
  createdAt: string;
}

interface ClientFormState {
  name: string;
  razonSocial: string;
  cif: string;
  contactPerson: string;
  phone: string;
  email: string;
  direccion: string;
  sector: string;
}

const EMPTY_FORM: ClientFormState = {
  name: "",
  razonSocial: "",
  cif: "",
  contactPerson: "",
  phone: "",
  email: "",
  direccion: "",
  sector: "",
};

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

export default function ClientesPage() {
  const { confirm } = useDialogs();
  const router = useRouter();
  const [search, setSearch] = useState("");

  // Datos remotos + copia local mutable (eliminación optimista).
  const { data: clientsData, loading, refetch } = useResource<ClientRecord[]>("/api/clients");
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const fetchClients = refetch;

  // Modal de alta / edición
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ClientFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setClients(Array.isArray(clientsData) ? clientsData : []);
  }, [clientsData]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (c: ClientRecord) => {
    setEditingId(c.id);
    setForm({
      name: c.name || "",
      razonSocial: c.razonSocial || "",
      cif: c.cif || "",
      contactPerson: c.contactPerson || "",
      phone: c.phone || "",
      email: c.email || "",
      direccion: c.direccion || c.address || "",
      sector: c.sector || "",
    });
    setFormError("");
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        name: form.name.trim(),
        razonSocial: form.razonSocial.trim() || null,
        cif: form.cif.trim() || null,
        contactPerson: form.contactPerson.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        direccion: form.direccion.trim() || null,
        sector: form.sector.trim() || null,
      };
      const res = await api<ClientRecord & { error?: string }>(
        editingId ? `/api/clients/${editingId}` : "/api/clients",
        {
          method: editingId ? "PUT" : "POST",
          body: JSON.stringify(payload),
        }
      );
      if (res && (res as any).error) {
        setFormError((res as any).error);
        return;
      }
      setModalOpen(false);
      await fetchClients();
    } catch (e) {
      console.error(e);
      setFormError("Error de red al guardar el cliente.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: ClientRecord) => {
    const ok = await confirm({
      title: "Eliminar cliente",
      message: `¿Eliminar el cliente "${c.name}"? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/clients/${c.id}`, { method: "DELETE" });
      setClients((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) {
      console.error(e);
    }
  };

  const filtered = clients.filter((c) => {
    const term = search.toLowerCase();
    return (
      (c.name || "").toLowerCase().includes(term) ||
      (c.contactPerson || "").toLowerCase().includes(term) ||
      (c.email || "").toLowerCase().includes(term) ||
      (c.codCliente || "").toLowerCase().includes(term)
    );
  });

  const { pageItems, page, setPage, totalPages, total } = usePagination(filtered);

  return (
    <div className="w-full">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="kicker mb-2 text-neon-cyan">CRM</div>
          <h1 className="text-3xl font-extrabold text-neon-gradient">Clientes</h1>
          <p className="text-sm text-slate-500 mt-1">
            Cartera de clientes y acceso directo a su facturación.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="bg-neon-gradient text-white font-bold rounded-xl px-5 py-2.5 flex items-center gap-2 hover:opacity-90 transition shadow-[0_0_15px_rgba(157,0,255,0.4)]"
        >
          <span className="text-lg leading-none">+</span> Nuevo cliente
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-edge">
          <input
            type="text"
            placeholder="Buscar por nombre, contacto, email o código..."
            className="input-dark max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500">Cargando clientes...</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No hay clientes"
            subtitle={'Pulsa en "Nuevo cliente" para dar de alta el primero.'}
          />
        ) : (
          <Table
            columns={[
              { header: "ID Cliente" },
              { header: "Nombre" },
              { header: "Contacto" },
              { header: "Teléfono" },
              { header: "Email" },
              { header: "Dirección" },
              { header: "Facturas", align: "center" },
              { header: "Acciones", align: "right" },
            ]}
          >
                {pageItems.map((c) => (
                  <tr key={c.id} className="hover:bg-white/[0.02] transition">
                    <td className="px-6 py-4 font-mono text-xs text-neon-cyan font-bold">
                      {c.codCliente || "—"}
                    </td>
                    <td className="px-6 py-4 text-white font-medium">{c.name}</td>
                    <td className="px-6 py-4 text-slate-300">{c.contactPerson || "—"}</td>
                    <td className="px-6 py-4 text-slate-400">{c.phone || "—"}</td>
                    <td className="px-6 py-4 text-slate-400">{c.email || "—"}</td>
                    <td className="px-6 py-4 text-slate-400 max-w-[220px] truncate">
                      {c.direccion || c.address || "—"}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => router.push(`/facturacion?clientId=${c.id}`)}
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
                          onClick={() => openEdit(c)}
                          className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold text-slate-300 transition"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleDelete(c)}
                          className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg text-xs font-bold text-red-400 transition"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
          </Table>
        )}
        {!loading && filtered.length > 0 && (
          <div className="px-4 border-t border-edge">
            <Pagination page={page} totalPages={totalPages} onChange={setPage} total={total} />
          </div>
        )}
      </div>

      {/* Modal alta / edición */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} closeDisabled={saving}>
            <h2 className="text-xl font-extrabold text-white mb-5">
              {editingId ? "Editar cliente" : "Nuevo cliente"}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Nombre comercial *</label>
                <input
                  className="input-dark"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Razón social</label>
                <input
                  className="input-dark"
                  value={form.razonSocial}
                  onChange={(e) => setForm({ ...form, razonSocial: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">NIF / CIF</label>
                <input
                  className="input-dark"
                  value={form.cif}
                  onChange={(e) => setForm({ ...form, cif: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Persona de contacto</label>
                <input
                  className="input-dark"
                  value={form.contactPerson}
                  onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
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
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1.5">Dirección</label>
                <input
                  className="input-dark"
                  value={form.direccion}
                  onChange={(e) => setForm({ ...form, direccion: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1.5">Sector</label>
                <input
                  className="input-dark"
                  value={form.sector}
                  onChange={(e) => setForm({ ...form, sector: e.target.value })}
                />
              </div>
            </div>

            {formError && (
              <p className="text-sm text-red-400 mt-4">{formError}</p>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className="px-4 py-2 border border-edge text-slate-300 hover:text-white hover:bg-white/5 rounded-xl font-bold transition text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="btn-grad px-6 py-2 text-sm disabled:opacity-50"
              >
                {saving ? "Guardando..." : editingId ? "Guardar cambios" : "Crear cliente"}
              </button>
            </div>
      </Modal>
    </div>
  );
}
