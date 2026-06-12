"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

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
  const router = useRouter();
  const [projects, setProjects] = useState<LandingProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadProjects() {
    setLoading(true);
    try {
      const data = await api<LandingProject[]>("/api/landing");
      setProjects(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadProjects(); }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const project = await api<LandingProject>("/api/landing", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim() }),
      });
      router.push(`/landing-builder/${project.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este proyecto? Esta acción no se puede deshacer.")) return;
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
        <button
          className="btn-grad"
          onClick={() => setShowCreate(true)}
        >
          + Nuevo proyecto
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="card p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-white mb-4">Nuevo proyecto</h2>
            <input
              className="input-dark mb-4"
              placeholder="Nombre del proyecto (ej. Landing Restaurante)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                className="btn-grad flex-1"
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
              >
                {creating ? "Creando..." : "Crear y empezar"}
              </button>
              <button
                className="btn-dark"
                onClick={() => { setShowCreate(false); setNewName(""); }}
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
                    {p.business && (
                      <p className="text-slate-400 text-xs mt-0.5">{p.business}</p>
                    )}
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
