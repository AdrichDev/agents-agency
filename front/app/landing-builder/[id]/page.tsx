"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { BuilderChat } from "@/components/landing/BuilderChat";
import { PromptPicker } from "@/components/landing/PromptPicker";
import { FileTree } from "@/components/landing/FileTree";
import { CodeEditor } from "@/components/landing/CodeEditor";
import { LivePreview } from "@/components/landing/LivePreview";
import { MobilePanel } from "@/components/landing/MobilePanel";
import type { LandingProject, AnswerEntry } from "@/components/landing/types";

type RightTab = "editor" | "preview" | "mobile";
type LeftTab = "chat" | "prompts";

export default function LandingBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<LandingProject | null>(null);
  const [loading, setLoading] = useState(true);

  // State
  const [answers, setAnswers] = useState<Record<string, AnswerEntry>>({});
  const [files, setFiles] = useState<Record<string, string>>({});
  const [mobileFiles, setMobileFiles] = useState<Record<string, string>>({});
  const [activePath, setActivePath] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("chat");
  const [rightTab, setRightTab] = useState<RightTab>("editor");
  const [decalogDone, setDecalogDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [dbProvider, setDbProvider] = useState("none");
  const [dbCollision, setDbCollision] = useState<{ collisions: string[]; diff: string } | null>(null);
  const [showDbModal, setShowDbModal] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function loadProject() {
    setLoading(true);
    try {
      const p = await api<LandingProject>(`/api/landing/${id}`);
      setProject(p);
      setAnswers(p.answers ?? {});
      setFiles(p.files ?? {});
      setMobileFiles(p.mobileFiles ?? {});
      setDbProvider(p.dbProvider ?? "none");
      const answeredCount = Object.keys(p.answers ?? {}).length;
      if (answeredCount >= 10) setDecalogDone(true);
      if (answeredCount >= 10 && Object.keys(p.files ?? {}).length === 0) {
        setLeftTab("prompts");
      }
      // Auto-select first file
      const firstFile = Object.keys(p.files ?? {})[0];
      if (firstFile) setActivePath(firstFile);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadProject(); }, [id]);

  // Derived: active file content
  const isMobilePath = activePath?.startsWith("mobile:");
  const resolvedPath = isMobilePath ? activePath!.replace("mobile:", "") : activePath;
  const activeContent = activePath
    ? isMobilePath
      ? mobileFiles[resolvedPath!] ?? ""
      : files[activePath] ?? ""
    : "";

  // Save edited file (debounced)
  function handleCodeChange(content: string) {
    if (!activePath) return;

    if (isMobilePath) {
      setMobileFiles((prev) => ({ ...prev, [resolvedPath!]: content }));
    } else {
      setFiles((prev) => ({ ...prev, [activePath]: content }));
      // Debounce save
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveFiles({ ...files, [activePath]: content }), 1500);
    }
  }

  async function saveFiles(updated: Record<string, string>) {
    setSaveStatus("saving");
    try {
      await api(`/api/landing/${id}/files`, {
        method: "PATCH",
        body: JSON.stringify({ files: updated }),
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    }
  }

  function handleDecalogDone(newAnswers: Record<string, AnswerEntry>) {
    setAnswers(newAnswers);
    setDecalogDone(true);
    setLeftTab("prompts");
  }

  function handleFilesGenerated(newFiles: Record<string, string>) {
    setFiles(newFiles);
    const firstFile = Object.keys(newFiles)[0];
    if (firstFile) setActivePath(firstFile);
    setRightTab("editor");
  }

  function handleMobileGenerated(newMobileFiles: Record<string, string>, mStack: string) {
    setMobileFiles(newMobileFiles);
    setRightTab("mobile");
    setProject((p) => p ? { ...p, mobileStack: mStack } : p);
  }

  async function handleRegenerate() {
    if (!feedback.trim()) return;
    setRegenerating(true);
    try {
      const res = await api<{ files: Record<string, string>; truncated: boolean }>(
        `/api/landing/${id}/regenerate`,
        { method: "POST", body: JSON.stringify({ feedback }) }
      );
      setFiles(res.files);
      setFeedback("");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleDbProviderChange(newProvider: string, confirm = false) {
    setBusy(true);
    try {
      const res = await api<
        | { files: Record<string, string>; truncated: boolean }
        | { collisions: string[]; diff: string }
      >(`/api/landing/${id}/db-provider`, {
        method: "POST",
        body: JSON.stringify({ dbProvider: newProvider, confirm }),
      });

      if ("collisions" in res) {
        setDbCollision(res);
        setShowDbModal(true);
      } else {
        setFiles(res.files);
        setDbProvider(newProvider);
        setDbCollision(null);
        setShowDbModal(false);
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
        Cargando proyecto...
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-white/5 bg-[var(--sidebar)]">
        <span className="text-lg">🎨</span>
        <h1 className="text-sm font-semibold text-white truncate max-w-xs">{project.name}</h1>
        <span className={`chip text-xs ${project.status === "generated" ? "text-emerald-400" : "text-slate-400"}`}>
          {project.status === "generated" ? "Generado" : "Borrador"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {saveStatus === "saving" && <span className="text-xs text-slate-400">Guardando...</span>}
          {saveStatus === "saved" && <span className="text-xs text-emerald-400">✓ Guardado</span>}
          {saveStatus === "error" && <span className="text-xs text-red-400">Error al guardar</span>}
        </div>
      </div>

      {/* Main layout: left panel + right panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: Chat + Prompts */}
        <div className="w-80 flex-shrink-0 flex flex-col border-r border-white/5 bg-[var(--sidebar)]">
          {/* Tab bar */}
          <div className="flex border-b border-white/5">
            {([["chat", "💬 Chat"], ["prompts", "✨ Prompts"]] as [LeftTab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                className={`flex-1 py-2 text-xs font-medium transition ${
                  leftTab === tab
                    ? "text-indigo-400 border-b-2 border-indigo-500"
                    : "text-slate-500 hover:text-slate-300"
                }`}
                onClick={() => setLeftTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {leftTab === "chat" && (
              <BuilderChat
                projectId={id}
                initialAnswers={answers}
                initialMessages={project?.chatMessages ?? []}
                onDone={handleDecalogDone}
              />
            )}
            {leftTab === "prompts" && (
              <div className="overflow-y-auto h-full">
                {!decalogDone && (
                  <div className="p-4 text-xs text-slate-400 text-center">
                    Completa el decálogo primero
                  </div>
                )}
                {decalogDone && (
                  <>
                    <PromptPicker
                      projectId={id}
                      answers={answers}
                      onGenerated={handleFilesGenerated}
                    />

                    {/* Regenerate section (only if files exist) */}
                    {Object.keys(files).length > 0 && (
                      <div className="px-4 pb-4 border-t border-white/5 pt-4">
                        <p className="kicker mb-2">Regenerar con feedback</p>
                        <textarea
                          className="input-dark text-xs resize-none mb-2"
                          rows={3}
                          placeholder='Ej. "Agrega sección de testimonios" o "Cambia el color principal a verde"'
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                        />
                        <button
                          className="btn-grad w-full text-xs py-2"
                          onClick={handleRegenerate}
                          disabled={regenerating || !feedback.trim()}
                        >
                          {regenerating ? "Regenerando..." : "🔄 Regenerar"}
                        </button>
                      </div>
                    )}

                    {/* DB provider change */}
                    {Object.keys(files).length > 0 && (
                      <div className="px-4 pb-4 border-t border-white/5 pt-4">
                        <p className="kicker mb-2">Cambiar capa de datos</p>
                        <select
                          className="input-dark text-xs mb-2"
                          value={dbProvider}
                          onChange={(e) => setDbProvider(e.target.value)}
                        >
                          <option value="none">Sin base de datos</option>
                          <option value="firebase">Firebase</option>
                          <option value="supabase">Supabase</option>
                          <option value="local-postgres">API local</option>
                        </select>
                        <button
                          className="btn-dark w-full text-xs py-2"
                          onClick={() => handleDbProviderChange(dbProvider)}
                          disabled={busy}
                        >
                          {busy ? "Aplicando..." : "Aplicar cambio"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: FileTree + Editor/Preview/Mobile */}
        <div className="flex-1 flex overflow-hidden">
          {/* File tree sidebar */}
          {(Object.keys(files).length > 0 || Object.keys(mobileFiles).length > 0) && (
            <div className="w-48 flex-shrink-0 border-r border-white/5">
              <FileTree
                files={files}
                mobileFiles={mobileFiles}
                activePath={activePath}
                onSelect={setActivePath}
                showMobile={Object.keys(mobileFiles).length > 0}
              />
            </div>
          )}

          {/* Main right area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Tab bar */}
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/5">
              {([["editor", "Editor"], ["preview", "Preview"], ["mobile", "📱 Móvil"]] as [RightTab, string][]).map(
                ([tab, label]) => (
                  <button
                    key={tab}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                      rightTab === tab
                        ? "bg-indigo-600/20 text-indigo-300"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                    onClick={() => setRightTab(tab)}
                  >
                    {label}
                  </button>
                )
              )}

              {activePath && rightTab === "editor" && (
                <span className="ml-auto text-xs text-slate-500 truncate max-w-xs">
                  {isMobilePath ? activePath.replace("mobile:", "") : activePath}
                </span>
              )}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              {rightTab === "editor" && (
                <CodeEditor
                  path={resolvedPath ?? null}
                  content={activeContent}
                  onChange={handleCodeChange}
                />
              )}
              {rightTab === "preview" && (
                <LivePreview html={files["index.html"] ?? ""} />
              )}
              {rightTab === "mobile" && (
                <MobilePanel
                  projectId={id}
                  files={files}
                  mobileFiles={mobileFiles}
                  onMobileGenerated={handleMobileGenerated}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* DB Collision Modal */}
      {showDbModal && dbCollision && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-lg">
            <h3 className="text-white font-semibold mb-2">⚠️ Conflicto detectado</h3>
            <p className="text-slate-400 text-sm mb-3">
              Los siguientes archivos serán modificados por la nueva capa de datos:
            </p>
            <ul className="mb-3">
              {dbCollision.collisions.map((f) => (
                <li key={f} className="text-amber-400 text-xs font-mono mb-1">• {f}</li>
              ))}
            </ul>
            <pre className="bg-black/30 rounded-xl p-3 text-xs text-slate-300 overflow-auto max-h-40 mb-4 font-mono">
              {dbCollision.diff}
            </pre>
            <div className="flex gap-3">
              <button
                className="btn-grad flex-1"
                onClick={() => handleDbProviderChange(dbProvider, true)}
                disabled={busy}
              >
                Confirmar y sobrescribir
              </button>
              <button
                className="btn-dark"
                onClick={() => { setShowDbModal(false); setDbCollision(null); }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
