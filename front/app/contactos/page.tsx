"use client";

import { Table } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import ContactRow from "@/components/contactos/ContactRow";
import ContactFormModal from "@/components/contactos/ContactFormModal";
import ContactInfoModal from "@/components/contactos/ContactInfoModal";
import ConvertConfirmModal from "@/components/contactos/ConvertConfirmModal";
import { useContactos } from "@/hooks/useContactos";
import { type ContactType, type ContactedStatus } from "@/components/contactos/contactTypes";

export default function ContactosPage() {
  const {
    filterType, setFilterType,
    filterContactado, setFilterContactado,
    contacts,
    loading,
    search, setSearch,
    modalOpen, setModalOpen,
    editingId,
    form, setForm,
    saving,
    formError,
    openCreate,
    openEdit,
    handleSave,
    info, setInfo,
    cycleContactado,
    handleDelete,
    selectionMode,
    selectedIds,
    selectedContacts,
    startSelection,
    cancelSelection,
    toggleSelect,
    confirmConvertOpen, setConfirmConvertOpen,
    converting,
    handleConvert,
    toggleSort,
    dirFor,
    pageItems,
    page, setPage,
    totalPages,
    total,
  } = useContactos();

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
      <ConvertConfirmModal
        open={confirmConvertOpen}
        contacts={selectedContacts}
        converting={converting}
        onClose={() => setConfirmConvertOpen(false)}
        onConfirm={handleConvert}
      />
    </div>
  );
}
