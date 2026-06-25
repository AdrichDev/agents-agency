"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/hooks/useResource";
import { useDialogs } from "@/components/ui/ConfirmProvider";
import { usePagination } from "@/hooks/usePagination";
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

/**
 * Estado + fetch de la página de contactos: filtros remotos, búsqueda y orden
 * cliente, paginación, modo selección → cliente, y CRUD optimista. Extraído de
 * la página; el comportamiento de red y los efectos son idénticos al inline
 * previo.
 */
export function useContactos() {
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

  return {
    // filtros
    filterType, setFilterType,
    filterContactado, setFilterContactado,
    // datos
    contacts,
    loading,
    // búsqueda
    search, setSearch,
    // modal alta/edición
    modalOpen, setModalOpen,
    editingId,
    form, setForm,
    saving,
    formError,
    openCreate,
    openEdit,
    handleSave,
    // modal info
    info, setInfo,
    // contactado / delete
    cycleContactado,
    handleDelete,
    // selección
    selectionMode,
    selectedIds,
    selectedContacts,
    startSelection,
    cancelSelection,
    toggleSelect,
    // conversión
    confirmConvertOpen, setConfirmConvertOpen,
    converting,
    handleConvert,
    // orden + paginación
    toggleSort,
    dirFor,
    pageItems,
    page, setPage,
    totalPages,
    total,
  };
}
