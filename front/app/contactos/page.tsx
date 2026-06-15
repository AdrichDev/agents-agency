"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/hooks/useResource";
import { Table } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/ConfirmProvider";
import { usePagination } from "@/hooks/usePagination";
import ContactRow from "@/components/contactos/ContactRow";
import ContactFormModal from "@/components/contactos/ContactFormModal";
import ContactInfoModal from "@/components/contactos/ContactInfoModal";
import {
  CONTACTADO_CYCLE,
  CONTACTADO_ORDER,
  EMPTY_FORM,
  type ContactedStatus,
  type ContactFormState,
  type ContactType,
  type ProspectContact,
  type SortKey,
} from "@/components/contactos/contactTypes";

export default function ContactosPage() {
  const { confirm } = useDialogs();
  // Filtros
  const [filterType, setFilterType] = useState<"" | ContactType>("");
  const [filterContactado, setFilterContactado] = useState<"" | ContactedStatus>("");

  // Datos remotos: el path lleva los filtros, así useResource refetch al cambiarlos.
  const contactsPath = (() => {
    const params = new URLSearchParams();
    if (filterType) params.set("type", filterType);
    if (filterContactado) params.set("contactado", filterContactado);
    const qs = params.toString();
    return `/api/contacts${qs ? `?${qs}` : ""}`;
  })();
  const { data: contactsData, loading, refetch } = useResource<ProspectContact[]>(contactsPath);
  // Copia local mutable para actualizaciones optimistas.
  const [contacts, setContacts] = useState<ProspectContact[]>([]);

  // Modal alta / edición
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ContactFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Búsqueda de texto (filtro cliente sobre los contactos cargados)
  const [search, setSearch] = useState("");

  // Modal de información del contacto (centrado, con fondo blur).
  const [info, setInfo] = useState<ProspectContact | null>(null);

  // Modo selección → añadir a cliente
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmConvertOpen, setConfirmConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    setContacts(Array.isArray(contactsData) ? contactsData : []);
  }, [contactsData]);

  const fetchContacts = refetch;

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (c: ProspectContact) => {
    setEditingId(c.id);
    setForm({
      type: c.type,
      name: c.name || "",
      phone: c.phone || "",
      email: c.email || "",
      sector: c.sector || "",
      direccion: c.direccion || "",
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
      // POST: omite opcionales vacíos (la validación zod rechaza strings vacíos).
      // PATCH: envía null para limpiar campos.
      const payload: Record<string, unknown> = {
        type: form.type,
        name: form.name.trim(),
      };
      const optional: Array<[keyof ContactFormState, string]> = [
        ["phone", form.phone.trim()],
        ["email", form.email.trim()],
        ["sector", form.sector.trim()],
        ["direccion", form.direccion.trim()],
      ];
      for (const [key, value] of optional) {
        if (value) payload[key] = value;
        else if (editingId) payload[key] = null;
      }

      const res = await api<ProspectContact & { error?: unknown }>(
        editingId ? `/api/contacts/${editingId}` : "/api/contacts",
        {
          method: editingId ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        }
      );
      if (res && (res as any).error) {
        const err = (res as any).error;
        setFormError(typeof err === "string" ? err : "Revisa los datos del formulario.");
        return;
      }
      setModalOpen(false);
      await fetchContacts();
    } catch (e) {
      console.error(e);
      setFormError("Error de red al guardar el contacto.");
    } finally {
      setSaving(false);
    }
  };

  const cycleContactado = async (c: ProspectContact) => {
    const next = CONTACTADO_CYCLE[c.contactado];
    // Optimista: refleja el cambio al instante y revierte si falla.
    setContacts((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, contactado: next } : x))
    );
    try {
      const res = await api<ProspectContact & { error?: unknown }>(
        `/api/contacts/${c.id}`,
        { method: "PATCH", body: JSON.stringify({ contactado: next }) }
      );
      if (res && (res as any).error) throw new Error("PATCH failed");
      // Si hay filtro activo de contactado, el registro puede salir de la vista.
      if (filterContactado) await fetchContacts();
    } catch (e) {
      console.error(e);
      setContacts((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, contactado: c.contactado } : x))
      );
    }
  };

  const handleDelete = async (c: ProspectContact) => {
    const ok = await confirm({
      title: "Eliminar contacto",
      message: `¿Eliminar el contacto "${c.name}" (${c.codigo})? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/contacts/${c.id}`, { method: "DELETE" });
      setContacts((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) {
      console.error(e);
    }
  };

  // ── Modo selección → añadir a cliente ──────────────────────────────────────
  const startSelection = () => {
    setSelectionMode(true);
    setSelectedIds(new Set());
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedContacts = contacts.filter((c) => selectedIds.has(c.id));

  // ── Ordenación por columna (cliente) ───────────────────────────────────────
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "createdAt",
    dir: "desc",
  });
  const toggleSort = (key: string) =>
    setSort((s) =>
      s.key === key
        ? { key: s.key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key: key as SortKey, dir: "asc" }
    );
  const dirFor = (k: SortKey) => (sort.key === k ? sort.dir : null);

  const visibleContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return contacts;
    return contacts.filter(
      (c) =>
        (c.codigo || "").toLowerCase().includes(term) ||
        (c.name || "").toLowerCase().includes(term) ||
        (c.email || "").toLowerCase().includes(term) ||
        (c.phone || "").toLowerCase().includes(term) ||
        (c.sector || "").toLowerCase().includes(term)
    );
  }, [contacts, search]);

  const sortedContacts = useMemo(() => {
    const arr = [...visibleContacts];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      let cmp = 0;
      if (key === "createdAt") {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (key === "contactado") {
        cmp = CONTACTADO_ORDER[a.contactado] - CONTACTADO_ORDER[b.contactado];
      } else {
        const av = String((a as unknown as Record<string, unknown>)[key] ?? "").toLowerCase();
        const bv = String((b as unknown as Record<string, unknown>)[key] ?? "").toLowerCase();
        cmp = av.localeCompare(bv, "es");
      }
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [visibleContacts, sort]);

  const { pageItems, page, setPage, totalPages, total } = usePagination(sortedContacts);

  const handleConvert = async () => {
    setConverting(true);
    try {
      const res = await api<{ created?: unknown[]; error?: unknown }>(
        "/api/contacts/convert-to-clients",
        { method: "POST", body: JSON.stringify({ ids: [...selectedIds] }) }
      );
      if (res && (res as any).error) throw new Error("convert failed");
      setConfirmConvertOpen(false);
      cancelSelection();
      await fetchContacts();
    } catch (e) {
      console.error(e);
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-8">
        <div className="kicker mb-2 text-neon-cyan">CRM</div>
        <h1 className="text-3xl font-extrabold text-neon-gradient">Posibles contactos</h1>
        <p className="text-sm text-slate-500 mt-1">
          Leads y prospectos comerciales con su estado de contacto.
        </p>
      </div>

      <div className="card overflow-hidden">
        {/* Filtros */}
        <div className="p-4 border-b border-edge flex flex-wrap items-center gap-4">
          <input
            type="text"
            placeholder="Buscar contacto..."
            className="input-dark max-w-xs text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">Tipo</label>
            <select
              className="input-dark !w-auto text-sm"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as "" | ContactType)}
            >
              <option value="">Todos</option>
              <option value="lead">Lead</option>
              <option value="prospecto">Prospecto</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">Contactado</label>
            <select
              className="input-dark !w-auto text-sm"
              value={filterContactado}
              onChange={(e) => setFilterContactado(e.target.value as "" | ContactedStatus)}
            >
              <option value="">Todos</option>
              <option value="si">Sí</option>
              <option value="no">No</option>
              <option value="nc">NC</option>
            </select>
          </div>

          {/* Acciones: nuevo contacto + añadir a cliente (modo selección) */}
          <div className="ml-auto flex items-center gap-2">
            {!selectionMode && (
              <button onClick={openCreate} className="btn-ghost">
                <span className="text-lg leading-none">+</span> Nuevo contacto
              </button>
            )}
            {selectionMode ? (
              <>
                <button
                  onClick={() => setConfirmConvertOpen(true)}
                  disabled={selectedIds.size === 0}
                  className="btn-grad px-4 py-2 text-sm disabled:opacity-50"
                >
                  Aceptar{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
                </button>
                <button onClick={cancelSelection} className="btn-ghost">
                  Cancelar
                </button>
              </>
            ) : (
              <button onClick={startSelection} className="btn-ghost">
                Añadir a cliente
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500">Cargando contactos...</div>
        ) : contacts.length === 0 ? (
          <EmptyState
            icon="📇"
            title="No hay contactos"
            subtitle={'Pulsa en "Nuevo contacto" o ajusta los filtros.'}
          />
        ) : (
          <Table
            cellPad="px-5"
            columns={[
              ...(selectionMode ? [{ header: "", align: "center" as const }] : []),
              { header: "Código", sortKey: "codigo", sortDir: dirFor("codigo"), onSort: toggleSort },
              { header: "Tipo" },
              { header: "Nombre", sortKey: "name", sortDir: dirFor("name"), onSort: toggleSort },
              { header: "Teléfono" },
              { header: "Email", sortKey: "email", sortDir: dirFor("email"), onSort: toggleSort },
              { header: "Sector", sortKey: "sector", sortDir: dirFor("sector"), onSort: toggleSort },
              {
                header: "Contactado",
                align: "center" as const,
                sortKey: "contactado",
                sortDir: dirFor("contactado"),
                onSort: toggleSort,
              },
              { header: "Fecha de alta", sortKey: "createdAt", sortDir: dirFor("createdAt"), onSort: toggleSort },
              { header: "Acciones", align: "center" as const },
            ]}
          >
                {pageItems.map((c) => (
                  <ContactRow
                    key={c.id}
                    c={c}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(c.id)}
                    onToggleSelect={toggleSelect}
                    onCycleContactado={cycleContactado}
                    onInfo={setInfo}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                  />
                ))}
          </Table>
        )}
        {!loading && totalPages > 1 && (
          <div className="px-4 py-2 border-t border-edge">
            <Pagination page={page} totalPages={totalPages} onChange={setPage} total={total} />
          </div>
        )}
      </div>

      {/* Modal alta / edición */}
      <ContactFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editingId={editingId}
        form={form}
        setForm={setForm}
        saving={saving}
        formError={formError}
        onSave={handleSave}
      />

      {/* Modal de información del contacto: centrado, con fondo blur (lo aporta Modal) */}
      <ContactInfoModal info={info} onClose={() => setInfo(null)} />

      {/* Modal confirmación: añadir a cliente */}
      <Modal
        open={confirmConvertOpen}
        onClose={() => setConfirmConvertOpen(false)}
        closeDisabled={converting}
        panelClassName="card w-full max-w-md p-6 max-h-[80vh] overflow-y-auto"
      >
        <h2 className="text-xl font-extrabold text-white mb-4">
          ¿Estás de acuerdo con agregar a cliente los siguientes contactos?
        </h2>
        <ul className="space-y-1.5 mb-6 max-h-[40vh] overflow-y-auto">
          {selectedContacts.map((c) => (
            <li key={c.id} className="text-sm text-slate-300 flex items-center gap-2">
              <span className="font-mono text-xs text-neon-cyan">{c.codigo}</span>
              <span className="text-white font-medium">{c.name}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setConfirmConvertOpen(false)}
            disabled={converting}
            className="px-4 py-2 border border-edge text-slate-300 hover:text-white hover:bg-white/5 rounded-xl font-bold transition text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={handleConvert}
            disabled={converting || selectedContacts.length === 0}
            className="btn-grad px-6 py-2 text-sm disabled:opacity-50"
          >
            {converting ? "Añadiendo..." : "Aceptar"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
