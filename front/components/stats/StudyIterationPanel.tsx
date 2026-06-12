"use client";

import { useState } from "react";
import { api } from "@/lib/api";

const SECTORS = [
  "Restauración", "Hostelería", "Retail", "Comercio", "Tecnología",
  "Salud", "Educación", "Inmobiliaria", "Legal", "Consultoría",
  "Construcción", "Industria", "Logística", "Finanzas", "Otros",
];

export interface StudyInputs {
  zone: string;
  postalCode?: string;
  radiusKm: number;
  expansionZones: string[];
  targetSectors: string[];
  avgBudget?: number;
}

interface Props {
  studyId: string;
  inputs: StudyInputs;
  placesConfigured?: boolean;
  /** true when the study already has generated sections (iteration mode) */
  hasSections?: boolean;
  onRegenerated: () => void;
}

export default function StudyIterationPanel({ studyId, inputs, placesConfigured, hasSections = true, onRegenerated }: Props) {
  // Without generated content the inputs form is the main action → start open
  const [open, setOpen] = useState(!hasSections);

  // Form state prefilled from current study inputs
  const [zone, setZone] = useState(inputs.zone ?? "");
  const [postalCode, setPostalCode] = useState(inputs.postalCode ?? "");
  const [radiusKm, setRadiusKm] = useState(String(inputs.radiusKm ?? 5));
  const [expansionZones, setExpansionZones] = useState((inputs.expansionZones ?? []).join(", "));
  const [selectedSectors, setSelectedSectors] = useState<string[]>(inputs.targetSectors ?? []);
  const [avgBudget, setAvgBudget] = useState(inputs.avgBudget ? String(inputs.avgBudget) : "");
  const [feedback, setFeedback] = useState("");
  const [refreshProspects, setRefreshProspects] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Show chips for the catalog plus any custom sectors already saved on the study
  const allSectors = Array.from(new Set([...SECTORS, ...selectedSectors]));

  function toggleSector(sector: string) {
    setSelectedSectors((prev) =>
      prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector]
    );
    if (errors.sectors) setErrors((e) => ({ ...e, sectors: "" }));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!zone.trim()) errs.zone = "La zona es obligatoria";
    if (postalCode && !/^\d+$/.test(postalCode)) errs.postalCode = "Solo caracteres numéricos";
    const radius = parseInt(radiusKm, 10);
    if (!radiusKm || isNaN(radius) || radius <= 0) errs.radiusKm = "Radio debe ser un entero positivo";
    if (selectedSectors.length === 0) errs.sectors = "Selecciona al menos un sector";
    if (feedback.length > 2000) errs.feedback = "Máximo 2000 caracteres";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    if (hasSections) {
      const ok = window.confirm(
        "Las secciones del estudio se reescribirán. Tus ediciones manuales se incorporan como contexto, pero el contenido puede cambiar. ¿Regenerar el estudio?"
      );
      if (!ok) return;
    }

    setLoading(true);
    setErrors({});
    let inputsSaved = false;
    try {
      const newInputs = {
        zone: zone.trim(),
        postalCode: postalCode.trim() || undefined,
        radiusKm: parseInt(radiusKm, 10),
        expansionZones: expansionZones.split(",").map((s) => s.trim()).filter(Boolean),
        targetSectors: selectedSectors,
        avgBudget: avgBudget ? parseFloat(avgBudget) : undefined,
      };

      // 1) Persist edited inputs (allowed in any study state)
      await api(`/api/market-studies/${studyId}`, {
        method: "PATCH",
        body: JSON.stringify({ inputs: newInputs }),
      });
      inputsSaved = true;

      // 2) Generate / regenerate iterating over the existing study
      await api(`/api/market-studies/${studyId}/generate`, {
        method: "POST",
        body: JSON.stringify({
          feedback: feedback.trim() || undefined,
          refreshProspects,
        }),
      });

      setFeedback("");
      onRegenerated();
    } catch (err) {
      const base = err instanceof Error ? err.message : "Error al generar el estudio";
      setErrors({
        submit: inputsSaved
          ? `Los parámetros se guardaron, pero la generación falló: ${base}. El contenido actual está desactualizado — vuelve a pulsar "${hasSections ? "Regenerar estudio" : "Generar con IA"}".`
          : base,
      });
    } finally {
      setLoading(false);
    }
  }

  const inputCls = (field: string) =>
    `w-full bg-[#0d0d16] border ${errors[field] ? "border-red-500/50" : "border-white/10"} text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50`;

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/2"
      >
        <span className="font-semibold text-white">
          {hasSections ? "Editar y regenerar" : "Editar parámetros y generar"}
        </span>
        <span className="text-slate-500 text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="border-t border-white/5 p-4 space-y-4">
          {/* Zone + postal code */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Zona / Ciudad <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                className={inputCls("zone")}
                value={zone}
                onChange={(e) => { setZone(e.target.value); if (errors.zone) setErrors((x) => ({ ...x, zone: "" })); }}
                placeholder="p.ej. Madrid, Salamanca"
              />
              {errors.zone && <p className="text-red-400 text-xs mt-1">{errors.zone}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Código postal</label>
              <input
                type="text"
                className={inputCls("postalCode")}
                value={postalCode}
                onChange={(e) => { setPostalCode(e.target.value); if (errors.postalCode) setErrors((x) => ({ ...x, postalCode: "" })); }}
                placeholder="28001"
                maxLength={10}
              />
              {errors.postalCode && <p className="text-red-400 text-xs mt-1">{errors.postalCode}</p>}
            </div>
          </div>

          {/* Radius + avgBudget */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Radio de búsqueda (km) <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                min={1}
                className={inputCls("radiusKm")}
                value={radiusKm}
                onChange={(e) => { setRadiusKm(e.target.value); if (errors.radiusKm) setErrors((x) => ({ ...x, radiusKm: "" })); }}
              />
              {errors.radiusKm && <p className="text-red-400 text-xs mt-1">{errors.radiusKm}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Ticket medio (€)</label>
              <input
                type="number"
                min={1}
                className={inputCls("avgBudget")}
                value={avgBudget}
                onChange={(e) => setAvgBudget(e.target.value)}
                placeholder="1200"
              />
            </div>
          </div>

          {/* Expansion zones */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Zonas de expansión (separadas por coma)
            </label>
            <input
              type="text"
              className={inputCls("expansionZones")}
              value={expansionZones}
              onChange={(e) => setExpansionZones(e.target.value)}
              placeholder="Barcelona, Valencia, Sevilla"
            />
          </div>

          {/* Target sectors */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Sectores objetivo <span className="text-red-400">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {allSectors.map((sector) => (
                <button
                  key={sector}
                  type="button"
                  onClick={() => toggleSector(sector)}
                  className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                    selectedSectors.includes(sector)
                      ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                      : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200"
                  }`}
                >
                  {sector}
                </button>
              ))}
            </div>
            {errors.sectors && <p className="text-red-400 text-xs mt-2">{errors.sectors}</p>}
          </div>

          {/* Iteration feedback */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Instrucciones para esta iteración (opcional)
            </label>
            <textarea
              rows={3}
              maxLength={2000}
              className={`${inputCls("feedback")} resize-y`}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="p.ej. Profundiza en el sector salud y ajusta el pricing al nuevo ticket medio"
            />
            {errors.feedback && <p className="text-red-400 text-xs mt-1">{errors.feedback}</p>}
          </div>

          {/* Refresh prospects */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={refreshProspects}
              onChange={(e) => setRefreshProspects(e.target.checked)}
              className="mt-0.5 accent-violet-500"
            />
            <span className="text-sm text-slate-300">
              Actualizar prospección (consume cuota de Google Places)
              {!placesConfigured && (
                <span className="block text-xs text-yellow-400 mt-0.5">
                  Requiere GOOGLE_MAPS_API_KEY configurada en el backend
                </span>
              )}
            </span>
          </label>

          {errors.submit && (
            <div className="card p-3 border-red-500/30 bg-red-500/10">
              <p className="text-red-400 text-sm">{errors.submit}</p>
            </div>
          )}

          {loading && (
            <p className="text-violet-300 text-sm animate-pulse">
              {hasSections ? "Regenerando" : "Generando"} estudio con IA… Esto puede tardar 30-60 segundos.
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary px-5 py-2 text-sm disabled:opacity-50"
          >
            {loading
              ? (hasSections ? "Regenerando…" : "Generando…")
              : (hasSections ? "Regenerar estudio" : "Generar con IA")}
          </button>
        </form>
      )}
    </div>
  );
}
