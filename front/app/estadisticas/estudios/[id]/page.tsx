"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import StarRating from "@/components/stats/StarRating";
import StudyIterationPanel from "@/components/stats/StudyIterationPanel";
import { useDialogs } from "@/components/ui/ConfirmProvider";

// ── Types ─────────────────────────────────────────────────────────────────

interface StudySection {
  key: string;
  title: string;
  markdown: string;
}

type WebsiteStatus = "no_web" | "web_no_chatbot" | "web_chatbot";

interface Prospect {
  placeId: string;
  name: string;
  address?: string;
  phone?: string;
  rating?: number;
  sector?: string;
  candidateServices: string[];
  status: "new" | "contacted" | "discarded";
  websiteStatus?: WebsiteStatus;
  websiteUrl?: string;
  opportunityScore?: number;
  unverified?: boolean;
  lat?: number;
  lng?: number;
  distanceKm?: number;
  outOfRadius?: boolean;
}

interface Study {
  id: string;
  title: string;
  inputs: any;
  sections: StudySection[];
  prospects: Prospect[];
  status: string;
  successScore?: number | null;
  createdAt: string;
  updatedAt: string;
  placesConfigured?: boolean;
}

// ── Tiny markdown renderer ─────────────────────────────────────────────

function renderMarkdown(md: string): string {
  if (!md) return "";
  return md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3 class='text-base font-semibold text-white mt-4 mb-1'>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 class='text-lg font-bold text-white mt-5 mb-2'>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1 class='text-xl font-bold text-white mt-6 mb-2'>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong class='text-white'>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em class='text-slate-300'>$1</em>")
    // Markdown links → anchor with noopener (must run before list/paragraph rules)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<a href='$2' target='_blank' rel='noopener noreferrer' class='text-violet-400 hover:text-violet-300 underline'>$1</a>")
    .replace(/^- (.+)$/gm, "<li class='ml-4 list-disc text-slate-300'>$1</li>")
    .replace(/(<li.*<\/li>\n?)+/g, (m) => `<ul class='space-y-0.5 my-2'>${m}</ul>`)
    .replace(/^(\d+)\. (.+)$/gm, "<li class='ml-4 list-decimal text-slate-300'>$2</li>")
    .replace(/\n\n/g, "</p><p class='text-slate-400 text-sm mt-2'>")
    .replace(/^(?!<[hul])(.+)$/gm, "<p class='text-slate-400 text-sm'>$1</p>");
}

// ── Recommended options parser ─────────────────────────────────────────

interface RecommendedOption {
  title: string;
  description: string;
  successScore: number;
  rationale: string;
}

function parseRecommendedOptions(markdown: string): RecommendedOption[] | null {
  // Try to extract a JSON array from a ```json fence or bare JSON array in the markdown
  const fenceMatch = markdown.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  const bareMatch = markdown.match(/(\[[\s\S]*"successScore"[\s\S]*?\])/);
  const raw = fenceMatch?.[1] ?? bareMatch?.[1];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (o: any) => typeof o?.title === "string" && typeof o?.successScore === "number"
    );
  } catch {
    return null;
  }
}

// ── Recommended options section ────────────────────────────────────────

function RecommendedOptionsSection({
  section,
  studyId,
  onUpdate,
}: {
  section: StudySection;
  studyId: string;
  onUpdate: (key: string, markdown: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = parseRecommendedOptions(section.markdown);

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((x) => !x)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/2"
      >
        <span className="font-semibold text-white">{section.title}</span>
        <span className="text-slate-500 text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-white/5 p-4 space-y-3">
          {options && options.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {options.map((opt, i) => (
                <div key={i} className="card p-4 border border-white/5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white text-sm">{opt.title}</span>
                    <StarRating value={opt.successScore} size="sm" />
                  </div>
                  <p className="text-slate-400 text-xs">{opt.description}</p>
                  {opt.rationale && (
                    <p className="text-slate-500 text-xs italic">Justificación: {opt.rationale}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            // Fallback: raw markdown render
            <div
              className="prose-dark text-sm"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(section.markdown) }}
            />
          )}
          {/* Always allow editing the raw markdown */}
          <details className="mt-2">
            <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300">
              Editar contenido raw
            </summary>
            <SectionEditor section={section} studyId={studyId} onUpdate={onUpdate} embedded />
          </details>
        </div>
      )}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Borrador", cls: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
    generating: { label: "Generando…", cls: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" },
    ready: { label: "Listo", cls: "text-green-400 bg-green-500/10 border-green-500/20" },
    error: { label: "Error", cls: "text-red-400 bg-red-500/10 border-red-500/20" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "text-slate-400 bg-slate-500/10 border-slate-500/20" };
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>{label}</span>;
}

// ── Website status badge ──────────────────────────────────────────────

function WebStatusBadge({ status }: { status?: WebsiteStatus }) {
  if (!status) return <span className="text-slate-600 text-xs">—</span>;
  const map: Record<WebsiteStatus, { label: string; cls: string }> = {
    no_web: { label: "Sin web", cls: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
    web_no_chatbot: { label: "Web s/chatbot", cls: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
    web_chatbot: { label: "Web c/chatbot", cls: "text-green-400 bg-green-500/10 border-green-500/20" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

// ── Section editor ────────────────────────────────────────────────────

function SectionEditor({
  section,
  studyId,
  onUpdate,
  embedded = false,
}: {
  section: StudySection;
  studyId: string;
  onUpdate: (key: string, markdown: string) => void;
  embedded?: boolean;
}) {
  const { confirm, notify } = useDialogs();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.markdown);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);
  const [open, setOpen] = useState(embedded); // embedded = starts open, no accordion

  async function save() {
    setSaving(true);
    try {
      await api(`/api/market-studies/${studyId}/sections/${section.key}`, {
        method: "PATCH",
        body: JSON.stringify({ markdown: draft }),
      });
      onUpdate(section.key, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    const ok = await confirm({
      title: "Regenerar sección",
      message: `¿Regenerar la sección "${section.title}"? El contenido actual se reemplazará.`,
      confirmText: "Regenerar",
    });
    if (!ok) return;
    setRegen(true);
    try {
      const result = await api<{ section: StudySection }>(`/api/market-studies/${studyId}/sections/${section.key}/regenerate`, {
        method: "POST",
      });
      setDraft(result.section.markdown);
      onUpdate(section.key, result.section.markdown);
      setEditing(false);
    } catch {
      await notify("Error al regenerar la sección", { tone: "error" });
    } finally {
      setRegen(false);
    }
  }

  // When embedded (used inside RecommendedOptionsSection), render just the edit UI, no accordion
  if (embedded) {
    return (
      <div className="space-y-2 pt-1">
        {!editing ? (
          <button
            onClick={() => { setEditing(true); setDraft(section.markdown); }}
            className="btn-ghost text-xs px-3 py-1.5 border border-white/10 rounded-lg text-slate-400 hover:text-white"
          >
            Editar markdown
          </button>
        ) : (
          <div className="space-y-2">
            <textarea
              rows={8}
              className="w-full bg-[#0d0d16] border border-white/10 text-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-violet-500/50 resize-y"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex gap-2">
              <button onClick={save} disabled={saving} className="btn-primary text-xs px-4 py-1.5 disabled:opacity-50">
                {saving ? "Guardando…" : "Guardar"}
              </button>
              <button onClick={() => { setEditing(false); setDraft(section.markdown); }} className="btn-ghost text-xs px-3 py-1.5 border border-white/10 rounded-lg text-slate-400 hover:text-white">
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((x) => !x)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/2"
      >
        <span className="font-semibold text-white">{section.title}</span>
        <span className="text-slate-500 text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-white/5 p-4 space-y-3">
          {!editing ? (
            <>
              <div
                className="prose-dark text-sm"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(section.markdown) }}
              />
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => { setEditing(true); setDraft(section.markdown); }}
                  className="btn-ghost text-xs px-3 py-1.5 border border-white/10 rounded-lg text-slate-400 hover:text-white"
                >
                  Editar
                </button>
                <button
                  onClick={regenerate}
                  disabled={regen}
                  className="btn-ghost text-xs px-3 py-1.5 border border-violet-500/20 rounded-lg text-violet-400 hover:text-violet-300 disabled:opacity-50"
                >
                  {regen ? "Regenerando…" : "Regenerar sección"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setPreview(false)}
                  className={`text-xs px-3 py-1 rounded-lg border ${!preview ? "bg-violet-500/20 border-violet-500/30 text-violet-300" : "border-white/10 text-slate-400"}`}
                >
                  Editor
                </button>
                <button
                  onClick={() => setPreview(true)}
                  className={`text-xs px-3 py-1 rounded-lg border ${preview ? "bg-violet-500/20 border-violet-500/30 text-violet-300" : "border-white/10 text-slate-400"}`}
                >
                  Vista previa
                </button>
              </div>

              {!preview ? (
                <textarea
                  rows={10}
                  className="w-full bg-[#0d0d16] border border-white/10 text-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-violet-500/50 resize-y"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              ) : (
                <div
                  className="text-sm"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
                />
              )}

              <div className="flex gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="btn-primary text-xs px-4 py-1.5 disabled:opacity-50"
                >
                  {saving ? "Guardando…" : "Guardar"}
                </button>
                <button
                  onClick={() => { setEditing(false); setDraft(section.markdown); }}
                  className="btn-ghost text-xs px-3 py-1.5 border border-white/10 rounded-lg text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Prospects table ───────────────────────────────────────────────────

type WebFilter = "all" | WebsiteStatus;

function ProspectsTable({
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

  // Sort by opportunityScore desc (nulls last), then filter
  const sorted = [...prospects].sort(
    (a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0)
  );
  const filtered = webFilter === "all" ? sorted : sorted.filter((p) => p.websiteStatus === webFilter);

  const filterBtns: { label: string; value: WebFilter }[] = [
    { label: "Todos", value: "all" },
    { label: "Sin web", value: "no_web" },
    { label: "Web sin chatbot", value: "web_no_chatbot" },
    { label: "Web con chatbot", value: "web_chatbot" },
  ];

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
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/market-studies/${studyId}/prospects/export`}
              download
              className="btn-ghost text-xs px-3 py-1.5 border border-green-500/20 rounded-lg text-green-400 hover:text-green-300"
            >
              Exportar CSV
            </a>
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
              {filtered.map((p) => (
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
                  <td className="py-2 pr-3 text-slate-400 max-w-[140px] truncate">{p.address ?? "—"}</td>
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
        </div>
      )}

      {filtered.length === 0 && prospects.length > 0 && (
        <p className="text-slate-500 text-xs">Sin prospectos con ese filtro.</p>
      )}
    </div>
  );
}

// ── Prospects adjust panel (iterative feedback) ───────────────────────

function ProspectsAdjustPanel({ studyId, onAdjusted }: { studyId: string; onAdjusted: () => void }) {
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
