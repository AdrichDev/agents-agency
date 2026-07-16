"use client";

import type { RefObject } from "react";

interface KbSource {
  source: string;
  chunks: number;
}
interface KbFileResult {
  source: string;
  chunks: number;
  duplicates: number;
  note?: string;
}

/**
 * Pestaña "Conocimiento" (RAG) del detalle de agente: ingesta por URL, subida de
 * archivos y listado de fuentes. Extraída de la página sin cambios de UI.
 */
export default function KnowledgeTab({
  agent,
  kbUrl,
  setKbUrl,
  kbStatus,
  sources,
  fileList,
  setFileList,
  fileResults,
  fileUploading,
  fileInputRef,
  onIngest,
  onUploadFiles,
  onDeleteSource,
}: {
  agent: any;
  kbUrl: string;
  setKbUrl: (v: string) => void;
  kbStatus: string;
  sources: KbSource[];
  fileList: FileList | null;
  setFileList: (f: FileList | null) => void;
  fileResults: KbFileResult[];
  fileUploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onIngest: (urlOverride?: string) => void;
  onUploadFiles: () => void;
  onDeleteSource: (source: string) => void;
}) {
  // F5: estado visible de la ingesta de la web inicial del wizard (antes
  // fire-and-forget silencioso) + re-ingesta.
  const initialIngest = agent.ecommerceConfig?.initialIngest as
    | { url: string; status: "pending" | "indexed" | "failed"; pages?: number; chunks?: number; error?: string }
    | undefined;

  return (
    <div className="card p-6 space-y-4">
      <h3 className="font-semibold text-sm text-white">Base de conocimiento (RAG)</h3>
      <p className="text-xs text-slate-500">
        {agent._count.knowledge} chunks indexados. Añade una URL para scrapearla e indexarla.
      </p>

      {initialIngest && (
        <div className="flex items-center justify-between gap-3 text-xs bg-black/20 border border-edge rounded-lg px-3 py-2">
          <div className="min-w-0">
            <span className="text-slate-400">Web inicial: </span>
            <span className="text-slate-300 truncate" title={initialIngest.url}>{initialIngest.url}</span>
            {initialIngest.status === "failed" && initialIngest.error && (
              <p className="text-red-400 truncate" title={initialIngest.error}>{initialIngest.error}</p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span
              className={
                initialIngest.status === "indexed"
                  ? "text-emerald-400"
                  : initialIngest.status === "failed"
                    ? "text-red-400"
                    : "text-amber-400"
              }
            >
              {initialIngest.status === "indexed"
                ? `Indexada ✓${initialIngest.chunks != null ? ` (${initialIngest.chunks} chunks)` : ""}`
                : initialIngest.status === "failed"
                  ? "Fallida"
                  : "Pendiente…"}
            </span>
            <button
              onClick={() => onIngest(initialIngest.url)}
              className="text-indigo-400 hover:text-indigo-300"
              title="Re-ingestar la web inicial"
            >
              ⟳ Re-indexar
            </button>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <input
          className="input-dark flex-1"
          placeholder="https://web-del-cliente.com"
          value={kbUrl}
          onChange={(e) => setKbUrl(e.target.value)}
        />
        <button onClick={() => onIngest()} disabled={!kbUrl} className="btn-grad">
          Indexar
        </button>
      </div>
      {kbStatus && <p className="text-xs text-slate-400">{kbStatus}</p>}

      {/* File upload */}
      <div className="border-t border-edge pt-4 space-y-2">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
          Subir archivos
        </h4>
        {/* Input nativo oculto: evita el "ningún archivo seleccionado" del navegador. */}
        <input
          ref={fileInputRef}
          id="kb-file-input"
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.html,.htm,.csv,.zip"
          className="hidden"
          onChange={(e) => setFileList(e.target.files)}
        />
        <label
          htmlFor="kb-file-input"
          className="btn-dark cursor-pointer text-center inline-block py-1.5 px-3 text-[11px] font-bold"
        >
          📎 Seleccionar archivos
        </label>
        <p className="text-[10px] text-slate-500">pdf, docx, txt, md, html, csv o .zip</p>

        {fileList && fileList.length > 0 && (
          <div className="space-y-2 pt-1">
            <ul className="text-xs text-slate-400 space-y-0.5">
              {Array.from(fileList).map((f, i) => (
                <li key={i} className="truncate" title={f.name}>• {f.name}</li>
              ))}
            </ul>
            <button
              onClick={onUploadFiles}
              disabled={fileUploading}
              className="btn-grad text-xs disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {fileUploading ? "Subiendo…" : `Subir ${fileList.length} archivo${fileList.length > 1 ? "s" : ""}`}
            </button>
          </div>
        )}
        {fileResults.length > 0 && (
          <ul className="mt-2 space-y-1">
            {fileResults.map((r, i) => (
              <li key={i} className="text-xs text-slate-300 flex gap-2">
                <span className="truncate text-slate-400" title={r.source}>{r.source}</span>
                {r.note ? (
                  <span className="text-amber-400">{r.note}</span>
                ) : (
                  <span className="text-emerald-400">{r.chunks} chunks</span>
                )}
                {r.duplicates > 0 && (
                  <span className="text-yellow-400">({r.duplicates} duplicados)</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Fuentes indexadas */}
      <div className="border-t border-edge pt-4">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
          Fuentes indexadas ({sources.length})
        </h4>
        {sources.length === 0 ? (
          <p className="text-xs text-slate-500">Aún no hay fuentes. Añade una URL arriba.</p>
        ) : (
          <ul className="space-y-1.5">
            {sources.map((s) => (
              <li key={s.source} className="flex items-center justify-between gap-3 text-xs bg-black/20 border border-edge rounded-lg px-3 py-2">
                <span className="text-slate-300 truncate" title={s.source}>{s.source}</span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-slate-500">{s.chunks} chunks</span>
                  <button
                    onClick={() => onDeleteSource(s.source)}
                    className="text-rose-400 hover:text-rose-300"
                    title="Borrar fuente"
                  >
                    🗑
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
