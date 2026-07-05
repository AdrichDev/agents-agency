"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ModelEffortSelect } from "@/components/ModelEffortSelect";

const SECTORS = [
  "Restauración", "Hostelería", "Retail", "Comercio", "Tecnología",
  "Salud", "Educación", "Inmobiliaria", "Legal", "Consultoría",
  "Construcción", "Industria", "Logística", "Finanzas", "Otros",
];

export default function NuevoEstudioPage() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [zone, setZone] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [radiusKm, setRadiusKm] = useState("5");
  const [expansionZones, setExpansionZones] = useState("");
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [avgBudget, setAvgBudget] = useState("");
  const [model, setModel] = useState("gpt-4.1-nano");
  const [reasoningEffort, setReasoningEffort] = useState("low");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function toggleSector(sector: string) {
    setSelectedSectors((prev) =>
      prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector]
    );
    if (errors.sectors) setErrors((e) => ({ ...e, sectors: "" }));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = "El título es obligatorio";
    if (!zone.trim()) errs.zone = "La zona es obligatoria";
    if (postalCode && !/^\d+$/.test(postalCode)) errs.postalCode = "Solo caracteres numéricos";
    const radius = parseInt(radiusKm, 10);
    if (!radiusKm || isNaN(radius) || radius <= 0) errs.radiusKm = "Radio debe ser un entero positivo";
    if (selectedSectors.length === 0) errs.sectors = "Selecciona al menos un sector";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const payload = {
        title: title.trim(),
        model,
        reasoningEffort,
        inputs: {
          zone: zone.trim(),
          postalCode: postalCode.trim() || undefined,
          radiusKm: parseInt(radiusKm, 10),
          expansionZones: expansionZones.split(",").map((s) => s.trim()).filter(Boolean),
          targetSectors: selectedSectors,
          avgBudget: avgBudget ? parseFloat(avgBudget) : undefined,
        },
      };
      const study = await api<{ id: string }>("/api/market-studies", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      router.push(`/estudios-mercado/${study.id}`);
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : "Error al crear el estudio" });
      setLoading(false);
    }
  }

  const inputCls = (field: string) =>
    `w-full bg-[#0d0d16] border ${errors[field] ? "border-red-500/50" : "border-white/10"} text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50`;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <span className="kicker">Estudios de mercado</span>
        <h1 className="text-2xl font-bold text-white mt-1">Nuevo estudio</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          El estudio se generará con IA usando datos reales del negocio
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Título del estudio <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            className={inputCls("title")}
            value={title}
            onChange={(e) => { setTitle(e.target.value); if (errors.title) setErrors((x) => ({ ...x, title: "" })); }}
            placeholder="p.ej. Mercado restauración Madrid 2026"
          />
          {errors.title && <p className="text-red-400 text-xs mt-1">{errors.title}</p>}
        </div>

        {/* Zone */}
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

        {/* Modelo + effort (componente compartido) */}
        <ModelEffortSelect
          model={model}
          effort={reasoningEffort}
          onModelChange={setModel}
          onEffortChange={setReasoningEffort}
          labelClassName="block text-sm font-medium text-slate-300 mb-1.5"
          selectClassName={inputCls("model")}
        />

        {/* Target sectors */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Sectores objetivo <span className="text-red-400">*</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {SECTORS.map((sector) => (
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

        {errors.submit && (
          <div className="card p-3 border-red-500/30 bg-red-500/10">
            <p className="text-red-400 text-sm">{errors.submit}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
          >
            {loading ? "Creando…" : "Crear estudio"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="btn-ghost px-4 py-2 text-sm border border-white/10 rounded-lg text-slate-400 hover:text-white"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
