"use client";

import { BuilderChat } from "@/components/landing/BuilderChat";
import { PromptPicker } from "@/components/landing/PromptPicker";
import { FileTree } from "@/components/landing/FileTree";
import { CodeEditor } from "@/components/landing/CodeEditor";
import { LivePreview } from "@/components/landing/LivePreview";
import { MobilePanel } from "@/components/landing/MobilePanel";
import { SetupWizard } from "@/components/landing/SetupWizard";
import { DbCollisionModal } from "@/components/landing/DbCollisionModal";
import { useLandingBuilder } from "@/hooks/useLandingBuilder";

type RightTab = "editor" | "preview" | "mobile";
type LeftTab = "decalogo" | "prompts";

export default function LandingBuilderPage() {
  const {
    id,
    project, setProject,
    loading,
    showWizard, setShowWizard,
    wizardStep,
    answers,
    files,
    mobileFiles,
    activePath, setActivePath,
    leftTab, setLeftTab,
    rightTab, setRightTab,
    decalogDone,
    busy,
    feedback, setFeedback,
    regenerating,
    saveStatus,
    dbProvider, setDbProvider,
    dbCollision, setDbCollision,
    showDbModal, setShowDbModal,
    resolvedPath,
    isMobilePath,
    activeContent,
    handleCodeChange,
    applyFiles,
    openWizard,
    handleDecalogDone,
    handleFilesGenerated,
    handleMobileGenerated,
    handleRegenerate,
    handleChatRegenerate,
    handleDbProviderChange,
  } = useLandingBuilder();

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
        <div className="ml-auto flex items-center gap-3">
          {saveStatus === "saving" && <span className="text-xs text-slate-400">Guardando...</span>}
          {saveStatus === "saved" && <span className="text-xs text-emerald-400">✓ Guardado</span>}
          {saveStatus === "error" && <span className="text-xs text-red-400">Error al guardar</span>}
        </div>
      </div>

      {/* Main layout: left panel + right panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: Decálogo + Prompts (dos pestañas) */}
        <div className="w-80 flex-shrink-0 self-start h-[75vh] flex flex-col border-r border-b border-white/5 bg-[var(--sidebar)]">
          {/* Tab bar */}
          <div className="flex border-b border-white/5">
            {([["decalogo", "📋 Decálogo"], ["prompts", "✨ Prompts"]] as [LeftTab, string][]).map(([tab, label]) => (
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
          <div className="flex-1 min-h-0 overflow-hidden">
            {/* Chat del decálogo SIEMPRE montado (oculto con CSS, no desmontado):
                preserva la conversación completa al saltar a Prompts y deja
                escribir desde la décima pregunta en adelante. */}
            <div className={`h-full flex-col ${leftTab === "decalogo" ? "flex" : "hidden"}`}>
              <BuilderChat
                projectId={id}
                initialAnswers={answers}
                initialMessages={project?.chatMessages ?? []}
                onDone={handleDecalogDone}
                onRegenerate={handleChatRegenerate}
                hasFiles={Object.keys(files).length > 0}
              />
            </div>

            <div className={`overflow-y-auto h-full ${leftTab === "prompts" ? "block" : "hidden"}`}>
                {!decalogDone && (
                  <div className="p-4 text-xs text-slate-400 text-center">
                    Completa el decálogo primero
                  </div>
                )}
                {decalogDone && (
                  <>
                    {/* Post-generación: enriquecer la landing ya creada */}
                    {Object.keys(files).length > 0 && (
                      <div className="px-4 pt-4 pb-2 flex gap-2">
                        <button className="btn-dark flex-1 text-xs py-2" onClick={() => openWizard(1)}>
                          🤖 Incluir Bot
                        </button>
                        <button className="btn-dark flex-1 text-xs py-2" onClick={() => openWizard(2)}>
                          🔳 QR
                        </button>
                      </div>
                    )}

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
                          <option value="creador-crm">Creador CRM</option>
                          <option value="webhook">Webhook / n8n</option>
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

      {/* Setup Wizard */}
      {showWizard && (
        <SetupWizard
          projectId={id}
          files={files}
          dbProvider={dbProvider}
          onApply={applyFiles}
          qrUrl={project.qrUrl}
          onQrSaved={(url) => setProject((p) => (p ? { ...p, qrUrl: url } : p))}
          onClose={() => setShowWizard(false)}
          initialStep={wizardStep}
        />
      )}

      {/* DB Collision Modal */}
      {showDbModal && dbCollision && (
        <DbCollisionModal
          collision={dbCollision}
          busy={busy}
          onConfirm={() => handleDbProviderChange(dbProvider, true)}
          onCancel={() => { setShowDbModal(false); setDbCollision(null); }}
        />
      )}
    </div>
  );
}
