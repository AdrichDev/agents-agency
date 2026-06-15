"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export default function ProspectsAdjustPanel({ studyId, onAdjusted }: { studyId: string; onAdjusted: () => void }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await api(`/api/market-studies/${studyId}/generate`, {
        method: "POST",
        body: JSON.stringify({
          feedback: feedback.trim() || undefined,
          refreshProspects: true,
        }),
      });
      setFeedback("");
      setOpen(false);
      onAdjusted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al ajustar los prospectos");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-white/5">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-sm text-violet-400 hover:text-violet-300 underline decoration-violet-500/40"
        >
          ¿Quieres ajustar los prospectos?
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-slate-400 text-xs">
            Describe cómo quieres ajustar la prospección (p.ej. "céntrate en clínicas dentales" o
            "descarta negocios sin teléfono"). Se repetirá la búsqueda en la zona y se actualizará
            el estudio con tus indicaciones (consume cuota de Google Places).
          </p>
          <textarea
            rows={3}
            maxLength={2000}
            className="w-full bg-[#0d0d16] border border-white/10 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50 resize-y"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="p.ej. Prioriza restaurantes y clínicas con web pero sin chatbot"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          {loading && (
            <p className="text-violet-300 text-xs animate-pulse">
              Actualizando prospección y estudio… Esto puede tardar 30-60 segundos.
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={loading}
              className="btn-primary text-xs px-4 py-1.5 disabled:opacity-50"
            >
              {loading ? "Ajustando…" : "Ajustar prospectos"}
            </button>
            <button
              onClick={() => { setOpen(false); setError(null); }}
              disabled={loading}
              className="btn-ghost text-xs px-3 py-1.5 border border-white/10 rounded-lg text-slate-400 hover:text-white disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
