"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import StarRating from "@/components/stats/StarRating";
import StudyIterationPanel from "@/components/stats/StudyIterationPanel";
import StatusBadge from "@/components/stats/StatusBadge";
import SectionEditor from "@/components/stats/SectionEditor";
import RecommendedOptionsSection from "@/components/stats/RecommendedOptionsSection";
import SwotGrid from "@/components/stats/SwotGrid";
import ProspectsTable from "@/components/stats/ProspectsTable";
import ProspectsAdjustPanel from "@/components/stats/ProspectsAdjustPanel";
import type { Study, Prospect } from "@/components/stats/studyTypes";
import { useDialogs } from "@/components/ui/ConfirmProvider";

// ── Detail page ───────────────────────────────────────────────────────

export default function EstudioDetailPage() {
  const { notify } = useDialogs();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [study, setStudy] = useState<Study | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genWarning, setGenWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingScore, setSavingScore] = useState(false);

  const fetchStudy = useCallback(() => {
    api<Study>(`/api/market-studies/${id}`)
      .then((data) => { setStudy(data); setLoading(false); })
      .catch((e) => { setError(e?.message ?? "Error al cargar"); setLoading(false); });
  }, [id]);

  useEffect(() => { fetchStudy(); }, [fetchStudy]);

  async function generate() {
    if (!study) return;
    setGenerating(true);
    setGenWarning(null);
    try {
      const result = await api<Study & { placesWarning?: string }>(`/api/market-studies/${id}/generate`, {
        method: "POST",
      });
      setStudy(result);
      if (result.placesWarning) setGenWarning(result.placesWarning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSuccessScoreChange(score: number) {
    if (!study) return;
    setSavingScore(true);
    try {
      const updated = await api<Study>(`/api/market-studies/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ successScore: score }),
      });
      setStudy((prev) => prev ? { ...prev, successScore: updated.successScore } : prev);
    } catch {
      await notify("Error al guardar la valoración", { tone: "error" });
    } finally {
      setSavingScore(false);
    }
  }

  function handleSectionUpdate(key: string, markdown: string) {
    setStudy((prev) => {
      if (!prev) return prev;
      const sections = prev.sections.map((s) => s.key === key ? { ...s, markdown } : s);
      return { ...prev, sections };
    });
  }

  function handleProspectsUpdate(prospects: Prospect[]) {
    setStudy((prev) => prev ? { ...prev, prospects } : prev);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="text-slate-500 animate-pulse text-sm">Cargando estudio…</span>
      </div>
    );
  }

  if (error || !study) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="card p-6 text-center">
          <p className="text-red-400 text-sm">{error ?? "Estudio no encontrado"}</p>
          <button onClick={() => router.back()} className="btn-ghost mt-3 text-sm px-4 py-2 border border-white/10 rounded-lg text-slate-400 hover:text-white">
            Volver
          </button>
        </div>
      </div>
    );
  }

  const hasSections = Array.isArray(study.sections) && study.sections.length > 0;
  const hasProspects = Array.isArray(study.prospects) && study.prospects.length > 0;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button
            onClick={() => router.back()}
            className="text-slate-500 hover:text-white text-sm mb-2 flex items-center gap-1"
          >
            ← Estudios
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">{study.title}</h1>
            <StatusBadge status={study.status} />
          </div>
          {/* Success score inline edit */}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-slate-500 text-xs">Valoración del estudio:</span>
            <StarRating
              value={study.successScore ?? null}
              editable={!savingScore}
              onChange={handleSuccessScoreChange}
              size="md"
            />
            {savingScore && <span className="text-slate-500 text-xs animate-pulse">Guardando…</span>}
          </div>
          <p className="text-slate-500 text-xs mt-1">
            Creado {new Date(study.createdAt).toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>

        {/* Generate button — available in EVERY state so a half-finished study can always continue */}
        {!hasSections ? (
          <button
            onClick={generate}
            disabled={generating}
            className="btn-primary px-5 py-2 text-sm disabled:opacity-50"
          >
            {generating ? "Generando…" : "Generar con IA"}
          </button>
        ) : (
          <button
            onClick={generate}
            disabled={generating}
            className="btn-ghost px-4 py-2 text-sm border border-white/10 rounded-lg text-slate-400 hover:text-white disabled:opacity-50"
          >
            {generating ? "Regenerando…" : "Regenerar completo"}
          </button>
        )}
      </div>

      {/* Generating status */}
      {generating && (
        <div className="card p-4 border-violet-500/20 bg-violet-500/5">
          <p className="text-violet-300 text-sm animate-pulse">
            Generando estudio con IA… Esto puede tardar 30-60 segundos.
          </p>
        </div>
      )}

      {/* Places warning */}
      {(genWarning || (!study.placesConfigured)) && (
        <div className="card p-3 border-yellow-500/20 bg-yellow-500/5">
          <p className="text-yellow-400 text-xs">
            {genWarning ?? "Requiere GOOGLE_MAPS_API_KEY para activar prospección"}
          </p>
        </div>
      )}

      {/* Edit inputs + generate/regenerate — inputs are ALWAYS editable, in any state */}
      {study.inputs && (
        <StudyIterationPanel
          key={study.updatedAt}
          studyId={id}
          inputs={study.inputs}
          placesConfigured={study.placesConfigured}
          hasSections={hasSections}
          onRegenerated={fetchStudy}
        />
      )}

      {/* Inputs summary */}
      {study.inputs && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Parámetros del estudio</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div><span className="text-slate-500">Zona</span><p className="text-slate-200 mt-0.5">{study.inputs.zone}</p></div>
            {study.inputs.postalCode && <div><span className="text-slate-500">CP</span><p className="text-slate-200 mt-0.5">{study.inputs.postalCode}</p></div>}
            <div><span className="text-slate-500">Radio</span><p className="text-slate-200 mt-0.5">{study.inputs.radiusKm} km</p></div>
            {study.inputs.avgBudget && <div><span className="text-slate-500">Ticket medio</span><p className="text-slate-200 mt-0.5">{study.inputs.avgBudget.toLocaleString("es-ES")} €</p></div>}
            {study.inputs.targetSectors?.length > 0 && (
              <div className="col-span-2">
                <span className="text-slate-500">Sectores</span>
                <p className="text-slate-200 mt-0.5">{study.inputs.targetSectors.join(", ")}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sections */}
      {hasSections && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-slate-200">Contenido del estudio</h2>
          {study.sections.map((section) =>
            section.key === "recommended_options" ? (
              <RecommendedOptionsSection
                key={section.key}
                section={section}
                studyId={id}
                onUpdate={handleSectionUpdate}
              />
            ) : section.key === "swot" ? (
              <SwotGrid
                key={section.key}
                section={section}
                studyId={id}
                onUpdate={handleSectionUpdate}
              />
            ) : (
              <SectionEditor
                key={section.key}
                section={section}
                studyId={id}
                onUpdate={handleSectionUpdate}
              />
            )
          )}
        </div>
      )}

      {/* Prospects */}
      {(hasSections || hasProspects) && (
        <div className="card p-5">
          <ProspectsTable
            key={`prospects-${study.updatedAt}`}
            studyId={id}
            prospects={study.prospects}
            onUpdate={handleProspectsUpdate}
          />
          {hasProspects && (
            <ProspectsAdjustPanel studyId={id} onAdjusted={fetchStudy} />
          )}
        </div>
      )}

      {/* Empty state */}
      {!hasSections && study.status === "draft" && (
        <div className="card p-10 text-center">
          <p className="text-slate-500 text-sm mb-3">
            El estudio aún no tiene contenido. Revisa los parámetros si lo necesitas y pulsa "Generar con IA".
          </p>
        </div>
      )}
    </div>
  );
}
