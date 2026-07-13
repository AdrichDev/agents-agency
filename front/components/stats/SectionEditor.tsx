"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useDialogs } from "@/components/ui/ConfirmProvider";
import { renderMarkdown } from "@/lib/markdown";
import type { StudySection } from "./studyTypes";

export default function SectionEditor({
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
  const [open, setOpen] = useState(true); // abierto por defecto (legibilidad); toggle sigue disponible

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
