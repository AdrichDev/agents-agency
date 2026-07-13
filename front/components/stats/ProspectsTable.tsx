"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import StarRating from "@/components/stats/StarRating";
import { useDialogs } from "@/components/ui/ConfirmProvider";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/hooks/usePagination";
import type { Prospect, WebsiteStatus } from "./studyTypes";
import WebStatusBadge from "./WebStatusBadge";

type WebFilter = "all" | WebsiteStatus;

export default function ProspectsTable({
  studyId,
  prospects: initial,
  onUpdate,
}: {
  studyId: string;
  prospects: Prospect[];
  onUpdate: (p: Prospect[]) => void;
}) {
  const { confirm, notify } = useDialogs();
  const [prospects, setProspects] = useState<Prospect[]>(initial);
  const [searching, setSearching] = useState(false);
  const [purging, setPurging] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [webFilter, setWebFilter] = useState<WebFilter>("all");

  const outOfRadiusCount = prospects.filter((p) => p.outOfRadius).length;

  async function purgeOutOfRadius() {
    const ok = await confirm({
      title: "Eliminar prospectos",
      message: `Se eliminarán ${outOfRadiusCount} prospecto(s) fuera del radio actual (los contactados se conservan). ¿Continuar?`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    setPurging(true);
    try {
      const result = await api<{ prospects: Prospect[]; removed: number }>(`/api/market-studies/${studyId}/prospects/purge-out-of-radius`, {
        method: "POST",
      });
      setProspects(result.prospects);
      onUpdate(result.prospects);
    } catch {
      setWarning("Error al limpiar los prospectos fuera de radio");
    } finally {
      setPurging(false);
    }
  }

  async function discover() {
    setSearching(true);
    setWarning(null);
    try {
      const result = await api<{ prospects: Prospect[]; warning?: string }>(`/api/market-studies/${studyId}/prospect`, {
        method: "POST",
      });
      setProspects(result.prospects);
      onUpdate(result.prospects);
      if (result.warning) setWarning(result.warning);
    } catch {
      setWarning("Error en la búsqueda de prospectos");
    } finally {
      setSearching(false);
    }
  }

  async function updateStatus(placeId: string, status: Prospect["status"]) {
    try {
      await api(`/api/market-studies/${studyId}/prospects/${placeId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      const updated = prospects.map((p) => p.placeId === placeId ? { ...p, status } : p);
      setProspects(updated);
      onUpdate(updated);
    } catch {
      await notify("Error al actualizar el estado", { tone: "error" });
    }
  }

  const STATUS_LABELS = { new: "Nuevo", contacted: "Contactado", discarded: "Descartado" };
  const STATUS_CLS: Record<string, string> = {
    new: "text-violet-400",
    contacted: "text-blue-400",
    discarded: "text-slate-500",
  };

  // Orden: dirección → sector → negocio (alfabético, locale es).
  const sorted = [...prospects].sort((a, b) => {
    const byAddr = (a.address ?? "").localeCompare(b.address ?? "", "es", { sensitivity: "base" });
    if (byAddr !== 0) return byAddr;
    const bySector = (a.sector ?? "").localeCompare(b.sector ?? "", "es", { sensitivity: "base" });
    if (bySector !== 0) return bySector;
    return (a.name ?? "").localeCompare(b.name ?? "", "es", { sensitivity: "base" });
  });
  const filtered = webFilter === "all" ? sorted : sorted.filter((p) => p.websiteStatus === webFilter);
  const prospectsPg = usePagination(filtered);

  const filterBtns: { label: string; value: WebFilter }[] = [
    { label: "Todos", value: "all" },
    { label: "Sin web", value: "no_web" },
    { label: "Web sin chatbot", value: "web_no_chatbot" },
    { label: "Web con chatbot", value: "web_chatbot" },
  ];

  // Export CSV client-side (el array ya está en memoria). Antes era un <a href> al back
  // sin Bearer → 401. Separador ';' + BOM para que Excel en español lo abra bien.
  function exportCsv() {
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const webLabel: Record<string, string> = { no_web: "Sin web", web_no_chatbot: "Web sin chatbot", web_chatbot: "Web con chatbot" };
    const statusLabel: Record<string, string> = { new: "Nuevo", contacted: "Contactado", discarded: "Descartado" };
    const header = ["Negocio", "Sector", "Dirección", "Teléfono", "Web", "Estado web", "Puntuación", "Rating", "Distancia (km)", "Estado", "Servicios"];
    const lines = [header.join(";")];
    for (const p of sorted) {
      lines.push([
        p.name, p.sector, p.address, p.phone, p.websiteUrl,
        p.websiteStatus ? webLabel[p.websiteStatus] : "",
        p.opportunityScore, p.rating,
        p.distanceKm != null ? p.distanceKm.toFixed(1) : "",
        statusLabel[p.status] ?? p.status,
        (p.candidateServices ?? []).join(", "),
      ].map(esc).join(";"));
    }
    const csv = "﻿" + lines.join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `prospectos-${studyId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-white">Prospectos ({prospects.length})</h3>
        <div className="flex gap-2">
          <button
            onClick={discover}
            disabled={searching}
            className="btn-ghost text-xs px-3 py-1.5 border border-white/10 rounded-lg text-slate-400 hover:text-white disabled:opacity-50"
          >
            {searching ? "Buscando…" : "Descubrir prospectos"}
          </button>
          {prospects.length > 0 && (
            <button
              onClick={exportCsv}
              className="btn-ghost text-xs px-3 py-1.5 border border-green-500/20 rounded-lg text-green-400 hover:text-green-300"
            >
              Exportar CSV
            </button>
          )}
        </div>
      </div>

      {/* Quick filters */}
      {prospects.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {filterBtns.map((f) => (
            <button
              key={f.value}
              onClick={() => setWebFilter(f.value)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                webFilter === f.value
                  ? "bg-violet-500/20 border-violet-500/30 text-violet-300"
                  : "border-white/10 text-slate-400 hover:text-slate-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {warning && (
        <div className="card p-3 border-yellow-500/20 bg-yellow-500/5">
          <p className="text-yellow-400 text-xs">{warning}</p>
        </div>
      )}

      {outOfRadiusCount > 0 && (
        <div className="card p-3 border-orange-500/20 bg-orange-500/5 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-orange-300 text-xs">
            {outOfRadiusCount} prospecto(s) quedan fuera del radio actual del estudio.
          </p>
          <button
            onClick={purgeOutOfRadius}
            disabled={purging}
            className="text-xs px-3 py-1.5 border border-orange-500/30 rounded-lg text-orange-300 hover:bg-orange-500/10 disabled:opacity-50"
          >
            {purging ? "Limpiando…" : "Limpiar fuera de radio"}
          </button>
        </div>
      )}

      {prospects.length === 0 && !searching && (
        <p className="text-slate-500 text-sm">
          Sin prospectos todavía. Pulsa "Descubrir prospectos" para buscar negocios en la zona.
        </p>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-white/5">
                <th className="text-left py-2 pr-3">Negocio</th>
                <th className="text-left py-2 pr-3">Sector</th>
                <th className="text-left py-2 pr-3">Dirección</th>
                <th className="text-left py-2 pr-3">Distancia</th>
                <th className="text-left py-2 pr-3">Rating</th>
                <th className="text-left py-2 pr-3">Web</th>
                <th className="text-left py-2 pr-3">Oportunidad</th>
                <th className="text-left py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {prospectsPg.pageItems.map((p) => (
                <tr key={p.placeId} className="border-b border-white/5 hover:bg-white/2">
                  <td className="py-2 pr-3 text-slate-200 font-medium">
                    {p.websiteUrl ? (
                      <a
                        href={p.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-violet-300 hover:text-violet-200 underline decoration-violet-500/40"
                        title={`Abrir ${p.websiteUrl} en una pestaña nueva`}
                      >
                        {p.name}
                      </a>
                    ) : (
                      p.name
                    )}
                  </td>
                  <td className="py-2 pr-3 text-slate-400">{p.sector ?? "—"}</td>
                  <td className="py-2 pr-3 text-slate-400 max-w-[160px] truncate">
                    {p.address ? (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-violet-300 hover:text-violet-200 underline decoration-violet-500/40"
                        title="Abrir en Google Maps"
                      >
                        {p.address}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {p.distanceKm != null ? (
                      <span className={p.outOfRadius ? "text-orange-400" : "text-slate-400"}>
                        {p.distanceKm} km{p.outOfRadius ? " ⚠" : ""}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-slate-400">{p.rating ? `${p.rating} ★` : "—"}</td>
                  <td className="py-2 pr-3">
                    <WebStatusBadge status={p.websiteStatus} />
                  </td>
                  <td className="py-2 pr-3">
                    <StarRating value={p.opportunityScore ?? null} size="sm" />
                  </td>
                  <td className="py-2">
                    <select
                      value={p.status}
                      onChange={(e) => updateStatus(p.placeId, e.target.value as Prospect["status"])}
                      className={`bg-transparent border-0 text-xs font-medium cursor-pointer focus:outline-none ${STATUS_CLS[p.status] ?? "text-slate-400"}`}
                    >
                      {(Object.entries(STATUS_LABELS) as [Prospect["status"], string][]).map(([val, label]) => (
                        <option key={val} value={val} className="bg-[#0d0d16] text-slate-200">{label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={prospectsPg.page}
            totalPages={prospectsPg.totalPages}
            onChange={prospectsPg.setPage}
            total={prospectsPg.total}
          />
        </div>
      )}

      {filtered.length === 0 && prospects.length > 0 && (
        <p className="text-slate-500 text-xs">Sin prospectos con ese filtro.</p>
      )}
    </div>
  );
}
