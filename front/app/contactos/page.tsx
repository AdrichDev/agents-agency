"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/hooks/useResource";
import { Badge, badgeVariantClass } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Table } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { Info, Pencil, Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/ConfirmProvider";
import { usePagination } from "@/hooks/usePagination";

type ContactType = "lead" | "prospecto";
type ContactedStatus = "si" | "no" | "nc";

interface ProspectContact {
  id: string;
  codigo: string;
  type: ContactType;
  name: string;
  phone: string | null;
  email: string | null;
  sector: string | null;
  direccion: string | null;
  peticion: string | null;
  contactado: ContactedStatus;
  contactedAt: string | null;
  createdAt: string;
  clientId: string | null;
  client?: { id: string; name: string; codCliente: string | null } | null;
}

interface ContactFormState {
  type: ContactType;
  name: string;
  phone: string;
  email: string;
  sector: string;
  direccion: string;
}

const EMPTY_FORM: ContactFormState = {
  type: "prospecto",
  name: "",
  phone: "",
  email: "",
  sector: "",
  direccion: "",
};

const CONTACTADO_CYCLE: Record<ContactedStatus, ContactedStatus> = {
  nc: "si",
  si: "no",
  no: "nc",
};

const CONTACTADO_LABELS: Record<ContactedStatus, string> = {
  si: "Sí",
  no: "No",
  nc: "NC",
};

type SortKey = "codigo" | "name" | "email" | "sector" | "contactado" | "createdAt";

/** Orden lógico de los estados de contacto al ordenar por esa columna. */
const CONTACTADO_ORDER: Record<ContactedStatus, number> = { si: 0, no: 1, nc: 2 };

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
                {pageItems.map((c) => {
                  const contactadoStyle = badgeVariantClass(c.contactado);
                  const isNewToday = c.contactado !== "si" && isToday(c.createdAt);
                  return (
                    <tr key={c.id} className="hover:bg-white/[0.02] transition">
                      {selectionMode && (
                        <td className="px-5 py-4 text-center">
                          <input
                            type="checkbox"
                            className="accent-indigo-500 w-4 h-4 cursor-pointer"
                            checked={selectedIds.has(c.id)}
                            onChange={() => toggleSelect(c.id)}
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
                          onClick={() => cycleContactado(c)}
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
                            onClick={() => setInfo(c)}
                            title="Ver información"
                            aria-label="Ver información"
                            className="icon-btn icon-btn-info"
                          >
                            <Info className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openEdit(c)}
                            title="Editar"
                            aria-label="Editar"
                            className="icon-btn icon-btn-edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(c)}
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
                })}
          </Table>
        )}
        {!loading && totalPages > 1 && (
          <div className="px-4 py-2 border-t border-edge">
            <Pagination page={page} totalPages={totalPages} onChange={setPage} total={total} />
          </div>
        )}
      </div>

      {/* Modal alta / edición */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} closeDisabled={saving}>
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
                {saving ? "Guardando..." : editingId ? "Guardar cambios" : "Crear contacto"}
              </button>
            </div>
      </Modal>

      {/* Modal de información del contacto: centrado, con fondo blur (lo aporta Modal) */}
      <Modal
        open={!!info}
        onClose={() => setInfo(null)}
        panelClassName="card w-full max-w-md p-6 max-h-[80vh] overflow-y-auto relative"
      >
        {info && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-extrabold text-white">Información del contacto</h2>
              <button
                onClick={() => setInfo(null)}
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
