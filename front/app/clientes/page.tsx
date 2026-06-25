"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useResource } from "@/hooks/useResource";
import { Table } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { useDialogs } from "@/components/ui/ConfirmProvider";
import { usePagination } from "@/hooks/usePagination";
import { ClientRow } from "@/components/clientes/ClientRow";
import { ClientModal } from "@/components/clientes/ClientModal";
import {
  EMPTY_FORM,
  type ClientFormState,
  type ClientRecord,
} from "@/components/clientes/types";

type SortKey = "codCliente" | "name" | "contactPerson" | "email" | "direccion";

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
      // Mostramos TOKENS DISPONIBLES (cupo − consumidos), que bajan con el uso.
      tokenBalance: String(Math.max(0, (c.tokenBalance ?? 0) - (c.tokensUsed ?? 0))),
      isActive: c.isActive ?? true,
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
      if (res && res.error) {
        setFormError(res.error);
        return;
      }
      // El input son TOKENS DISPONIBLES (restantes). El cupo (tokenBalance) que persiste
      // el backend = disponibles + consumidos, así "restantes = lo introducido" y el
      // consumo previo se conserva. Si no se toca el campo, el cupo no cambia.
      const enteredRemaining = parseInt(form.tokenBalance, 10) || 0;
      const usedTokens = editingClient?.tokensUsed ?? 0;
      const balanceNum = enteredRemaining + usedTokens;
      const targetId = editingId ?? res?.id;
      if (targetId && (editingId || enteredRemaining > 0)) {
        await api(`/api/clients/${targetId}/credits`, {
          method: "PATCH",
          body: JSON.stringify({ tokenBalance: balanceNum, isActive: form.isActive }),
        });
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

  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });
  const toggleSort = (key: string) =>
    setSort((s) =>
      s.key === key
        ? { key: s.key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key: key as SortKey, dir: "asc" }
    );
  const dirFor = (k: SortKey) => (sort.key === k ? sort.dir : null);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      const av = String((a as unknown as Record<string, unknown>)[key] ?? "").toLowerCase();
      const bv = String((b as unknown as Record<string, unknown>)[key] ?? "").toLowerCase();
      const cmp = av.localeCompare(bv, "es");
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sort]);

  const { pageItems, page, setPage, totalPages, total } = usePagination(sorted);

  // Cliente en edición (para mostrar tokens consumidos en el modal de créditos).
  const editingClient = editingId ? clients.find((x) => x.id === editingId) ?? null : null;

  return (
    <div className="w-full">
      <div className="mb-8">
        <div className="kicker mb-2 text-neon-cyan">CRM</div>
        <h1 className="text-3xl font-extrabold text-neon-gradient">Clientes</h1>
        <p className="text-sm text-slate-500 mt-1">
          Cartera de clientes y acceso directo a su facturación.
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-edge flex items-center justify-between gap-4 flex-wrap">
          <input
            type="text"
            placeholder="Buscar por nombre, contacto, email o código..."
            className="input-dark max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button onClick={openCreate} className="btn-ghost">
            <span className="text-lg leading-none">+</span> Nuevo cliente
          </button>
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
              { header: "ID Cliente", sortKey: "codCliente", sortDir: dirFor("codCliente"), onSort: toggleSort },
              { header: "Nombre", sortKey: "name", sortDir: dirFor("name"), onSort: toggleSort },
              { header: "Contacto", sortKey: "contactPerson", sortDir: dirFor("contactPerson"), onSort: toggleSort },
              { header: "Teléfono" },
              { header: "Email", sortKey: "email", sortDir: dirFor("email"), onSort: toggleSort },
              { header: "Tokens IA", align: "left" },
              { header: "Facturas", align: "center" },
              { header: "Acciones", align: "center" },
            ]}
          >
            {pageItems.map((c) => (
              <ClientRow
                key={c.id}
                client={c}
                onEdit={openEdit}
                onDelete={handleDelete}
                onOpenInvoices={(client) => router.push(`/facturacion?clientId=${client.id}`)}
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
      <ClientModal
        open={modalOpen}
        editingId={editingId}
        form={form}
        saving={saving}
        formError={formError}
        onChange={setForm}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}
