"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import StarRating from "@/components/stats/StarRating";
import StatusBadge from "@/components/stats/StatusBadge";
import { useDialogs } from "@/components/ui/ConfirmProvider";
import { Pagination } from "@/components/ui/Pagination";
import { Table } from "@/components/ui/Table";
import { Eye, Trash2 } from "lucide-react";
import { usePagination } from "@/hooks/usePagination";

export default function StudiesPanel() {
  const { confirm, notify } = useDialogs();

  // Studies state
  const [studies, setStudies] = useState<any[]>([]);
  const [studiesLoading, setStudiesLoading] = useState(false);
  const [studiesError, setStudiesError] = useState<string | null>(null);
  const studiesPg = usePagination(studies);

  const fetchStudies = useCallback(() => {
    setStudiesLoading(true);
    setStudiesError(null);
    api<any[]>("/api/market-studies")
      .then((data) => { setStudies(data); setStudiesLoading(false); })
      .catch((e) => { setStudiesError(e?.message ?? "Error al cargar estudios"); setStudiesLoading(false); });
  }, []);

  useEffect(() => {
    fetchStudies();
  }, [fetchStudies]);

  async function handleDeleteStudy(id: string) {
    const ok = await confirm({
      title: "Eliminar estudio",
      message: "¿Eliminar este estudio? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/market-studies/${id}`, { method: "DELETE" });
      setStudies((prev) => prev.filter((s) => s.id !== id));
    } catch {
      await notify("Error al eliminar el estudio", { tone: "error" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-slate-500 text-sm">
          Estudios de mercado generados con IA, anclados a datos reales del negocio
        </p>
        <Link href="/estudios-mercado/nuevo" className="btn-ghost">
          + Nuevo estudio
        </Link>
      </div>

      {studiesLoading && (
        <div className="flex items-center justify-center py-12">
          <span className="text-slate-500 animate-pulse text-sm">Cargando estudios…</span>
        </div>
      )}

      {studiesError && (
        <div className="card p-4 text-red-400 text-sm">{studiesError}</div>
      )}

      {!studiesLoading && !studiesError && studies.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-slate-500 text-sm mb-3">No hay estudios de mercado todavía</p>
          <Link href="/estudios-mercado/nuevo" className="btn-ghost">
            Crear primer estudio
          </Link>
        </div>
      )}

      {!studiesLoading && studies.length > 0 && (
        <div className="card overflow-hidden">
          <Table
            columns={[
              { header: "Nombre" },
              { header: "Fecha" },
              { header: "Éxito" },
              { header: "Estado" },
              { header: "Acciones", align: "right" },
            ]}
          >
            {studiesPg.pageItems.map((study) => (
              <tr key={study.id} className="hover:bg-white/[0.02] transition">
                <td className="px-6 py-4 text-white font-medium max-w-[240px] truncate">
                  {study.title}
                </td>
                <td className="px-6 py-4 text-slate-400 whitespace-nowrap">
                  {new Date(study.createdAt).toLocaleDateString("es-ES", {
                    year: "numeric", month: "short", day: "numeric",
                  })}
                </td>
                <td className="px-6 py-4">
                  <StarRating value={study.successScore ?? null} />
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={study.status} />
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/estudios-mercado/${study.id}`}
                      title="Abrir"
                      aria-label="Abrir"
                      className="icon-btn icon-btn-edit"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                    <button
                      onClick={() => handleDeleteStudy(study.id)}
                      title="Eliminar"
                      aria-label="Eliminar"
                      className="icon-btn icon-btn-delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
          {studiesPg.totalPages > 1 && (
            <div className="px-4 py-2 border-t border-edge">
              <Pagination
                page={studiesPg.page}
                totalPages={studiesPg.totalPages}
                onChange={studiesPg.setPage}
                total={studiesPg.total}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
