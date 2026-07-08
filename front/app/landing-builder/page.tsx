"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useDialogs } from "@/components/ui/ConfirmProvider";

interface LandingProject {
  id: string;
  name: string;
  business: string | null;
  status: string;
  dbProvider: string;
  mobileStack: string | null;
  createdAt: string;
  updatedAt: string;
}

function statusLabel(status: string) {
  if (status === "generated") return { text: "Generado", color: "text-emerald-400" };
  return { text: "Borrador", color: "text-slate-400" };
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}

export default function LandingBuilderPage() {
  const { confirm } = useDialogs();
  const router = useRouter();
  const [projects, setProjects] = useState<LandingProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState("");

  async function loadData() {
    setLoading(true);
    try {
      const [projectsData, clientsData] = await Promise.all([
        api<LandingProject[]>("/api/landing"),
        api<any[]>("/api/clients").catch(() => []) // Fallback in case clients fails
      ]);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      
      const sortedClients = Array.isArray(clientsData) 
        ? clientsData.sort((a, b) => a.name.localeCompare(b.name))
        : [];
      setClients(sortedClients);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  async function handleCreate() {
    if (!selectedClient) return;
    const clientObj = clients.find(c => c.id === selectedClient);
    if (!clientObj) return;

    setCreating(true);
    try {
      const project = await api<LandingProject>("/api/landing", {
        method: "POST",
        body: JSON.stringify({ 
          name: clientObj.name,
          business: selectedClient
        }),
      });
      router.push(`/landing-builder/${project.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Eliminar proyecto",
      message: "¿Eliminar este proyecto? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    setDeletingId(id);
    try {
      await api(`/api/landing/${id}`, { method: "DELETE" });
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="kicker mb-1">Landing Builder</p>
          <h1 className="text-2xl font-bold text-white">
            🎨 Tus proyectos de landing
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Crea landings profesionales con IA conversacional
          </p>
        </div>
        <button className="btn-ghost" onClick={() => setShowCreate(true)}>
          + Nuevo proyecto
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="card p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-white mb-4">Nuevo proyecto</h2>
            <select
              className="input-dark mb-4 w-full"
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
            >
              <option value="">Selecciona un cliente (obligatorio)</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="flex gap-3">
              <button
                className="btn-grad flex-1"
                onClick={handleCreate}
                disabled={creating || !selectedClient}
              >
                {creating ? "Creando..." : "Crear y empezar"}
              </button>
              <button
                className="btn-dark"
                onClick={() => { setShowCreate(false); setSelectedClient(""); }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project list */}
      {loading ? (
        <div className="text-slate-400 text-sm">Cargando proyectos...</div>
      ) : projects.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-4xl mb-4">🎨</p>
          <p className="text-white font-semibold mb-2">Sin proyectos aún</p>
          <p className="text-slate-400 text-sm mb-6">
            Crea tu primer landing page con el asistente conversacional
          </p>
          <button className="btn-grad" onClick={() => setShowCreate(true)}>
            Crear primer proyecto
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => {
            const { text: statusText, color: statusColor } = statusLabel(p.status);
            return (
              <div key={p.id} className="card card-hover p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-white font-semibold text-sm leading-tight">{p.name}</p>
                    {p.business && (() => {
                      const client = clients.find(c => c.id === p.business);
                      if (client?.contactPerson) {
                        return <p className="text-slate-400 text-xs mt-0.5">{client.contactPerson}</p>;
                      }
                      return null;
                    })()}
                  </div>
                  <span className={`chip text-xs ${statusColor}`}>{statusText}</span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {p.dbProvider !== "none" && (
                    <span className="chip">{p.dbProvider}</span>
                  )}
                  {p.mobileStack && (
                    <span className="chip">📱 {p.mobileStack}</span>
                  )}
                  <span className="chip">{timeAgo(p.updatedAt)}</span>
                </div>

                <div className="flex gap-2 mt-auto pt-2 border-t border-white/5">
                  <button
                    className="btn-grad flex-1 text-xs py-1.5"
                    onClick={() => router.push(`/landing-builder/${p.id}`)}
                  >
                    Abrir
                  </button>
                  <button
                    className="btn-dark text-xs py-1.5 px-3"
                    onClick={() => handleDelete(p.id)}
                    disabled={deletingId === p.id}
                  >
                    {deletingId === p.id ? "..." : "Borrar"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
