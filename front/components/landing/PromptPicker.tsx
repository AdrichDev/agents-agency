"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { AnswerEntry } from "./types";

interface Props {
  projectId: string;
  answers: Record<string, AnswerEntry>;
  onGenerated: (files: Record<string, string>) => void;
}

export function PromptPicker({ projectId, answers: _answers, onGenerated }: Props) {
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dbProvider, setDbProvider] = useState<"none" | "firebase" | "supabase" | "local-postgres">("none");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prompts = [generationPrompt, ...alternatives].filter(Boolean);
  const activePrompt = prompts[selectedIdx] ?? generationPrompt;

  async function loadPrompts() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ generationPrompt: string; alternatives: string[] }>(
        `/api/landing/${projectId}/prompts`,
        { method: "POST" }
      );
      setGenerationPrompt(res.generationPrompt);
      setAlternatives(res.alternatives ?? []);
      setSelectedIdx(0);
    } catch (e) {
      setError("Error al generar el prompt. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  async function generate() {
    if (!activePrompt.trim()) return;
    setGenerating(true);
    setError(null);
    setTruncated(false);
    try {
      const res = await api<{ files: Record<string, string>; truncated: boolean; error?: string }>(
        `/api/landing/${projectId}/generate`,
        {
          method: "POST",
          body: JSON.stringify({ generationPrompt: activePrompt, dbProvider }),
        }
      );
      if (res.error) { setError(res.error); return; }
      if (res.truncated) setTruncated(true);
      onGenerated(res.files);
    } catch (e) {
      setError("Error al generar la landing. Inténtalo de nuevo.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="kicker mb-2">Prompt de Generación</p>
        <p className="text-xs text-slate-400 mb-3">
          La IA crea el prompt a partir de tus respuestas. Puedes editarlo antes de generar.
        </p>

        {prompts.length === 0 && (
          <button
            className="btn-grad w-full text-sm"
            onClick={loadPrompts}
            disabled={loading}
          >
            {loading ? "Generando prompt..." : "✨ Generar prompt"}
          </button>
        )}
      </div>

      {prompts.length > 0 && (
        <>
          {/* Prompt selector */}
          <div className="flex gap-2 flex-wrap">
            {prompts.map((_, i) => (
              <button
                key={i}
                className={`text-xs px-3 py-1 rounded-full border transition ${
                  selectedIdx === i
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20"
                }`}
                onClick={() => setSelectedIdx(i)}
              >
                {i === 0 ? "Principal" : `Variante ${i}`}
              </button>
            ))}
          </div>

          {/* Editable prompt */}
          <textarea
            className="input-dark text-sm resize-none"
            rows={8}
            value={prompts[selectedIdx] ?? ""}
            onChange={(e) => {
              if (selectedIdx === 0) setGenerationPrompt(e.target.value);
              else {
                const newAlts = [...alternatives];
                newAlts[selectedIdx - 1] = e.target.value;
                setAlternatives(newAlts);
              }
            }}
            placeholder="Edita el prompt aquí..."
          />

          {/* DB Provider */}
          <div>
            <label className="kicker block mb-2">Capa de datos</label>
            <select
              className="input-dark text-sm"
              value={dbProvider}
              onChange={(e) => setDbProvider(e.target.value as typeof dbProvider)}
            >
              <option value="none">Sin base de datos</option>
              <option value="firebase">Firebase</option>
              <option value="supabase">Supabase</option>
              <option value="local-postgres">API local (PostgreSQL)</option>
            </select>
          </div>

          {truncated && (
            <div className="text-amber-400 text-xs bg-amber-400/10 border border-amber-400/20 rounded-xl px-3 py-2">
              ⚠️ Los archivos generados superan 300KB. Parte del contenido puede estar incompleto.
            </div>
          )}

          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          <button
            className="btn-grad w-full text-sm"
            onClick={generate}
            disabled={generating || !activePrompt.trim()}
          >
            {generating ? "Generando landing..." : "🚀 Generar landing"}
          </button>
        </>
      )}
    </div>
  );
}
