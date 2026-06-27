"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getWebbotKey, injectWebbot } from "@/components/landing/webbot";
import type { LandingProject, AnswerEntry } from "@/components/landing/types";

type RightTab = "editor" | "preview" | "mobile";
type LeftTab = "decalogo" | "prompts";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type DbCollision = { collisions: string[]; diff: string };

/**
 * Estado + fetch del builder de landings. Extrae la lógica de datos de la página
 * para que `page.tsx` quede solo con la composición de UI. Comportamiento idéntico
 * al inline previo (mismas llamadas de red, mismo orden de efectos).
 */
export function useLandingBuilder() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [project, setProject] = useState<LandingProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);

  // State
  const [answers, setAnswers] = useState<Record<string, AnswerEntry>>({});
  const [files, setFiles] = useState<Record<string, string>>({});
  const [mobileFiles, setMobileFiles] = useState<Record<string, string>>({});
  const [activePath, setActivePath] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("decalogo");
  const [rightTab, setRightTab] = useState<RightTab>("editor");
  const [decalogDone, setDecalogDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [dbProvider, setDbProvider] = useState("none");
  const [dbCollision, setDbCollision] = useState<DbCollision | null>(null);
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
      if (answeredCount >= 10) { setDecalogDone(true); setLeftTab("prompts"); }
      // Auto-select first file
      const firstFile = Object.keys(p.files ?? {})[0];
      if (firstFile) setActivePath(firstFile);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadProject(); }, [id]);

  // Retorno desde /agents/new: auto-incluye el webbot del agente recién creado.
  useEffect(() => {
    const newAgentId = searchParams.get("newAgentId");
    if (!newAgentId || loading) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await api<{ id: string; publicKey: string }[]>("/api/agents");
        const agent = list.find((a) => a.id === newAgentId);
        if (!agent || cancelled) return;
        setFiles((prev) => {
          if (!("index.html" in prev)) return prev;
          const updated = { ...prev, "index.html": injectWebbot(prev["index.html"], agent.publicKey) };
          saveFiles(updated);
          return updated;
        });
        openWizard(1);
      } finally {
        router.replace(`/landing-builder/${id}`);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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

  // Aplica un set de archivos completo (usado por el panel del webbot) y persiste.
  function applyFiles(updated: Record<string, string>) {
    setFiles(updated);
    saveFiles(updated);
  }

  // Tras regenerar, reinyecta el webbot si estaba presente (regenerate sobrescribe).
  function preserveEmbeds(prev: Record<string, string>, next: Record<string, string>): Record<string, string> {
    if (!("index.html" in next)) return next;
    const webbotKey = getWebbotKey(prev["index.html"] ?? "");
    if (!webbotKey) return next;
    return { ...next, "index.html": injectWebbot(next["index.html"], webbotKey) };
  }

  function openWizard(step: number) {
    setWizardStep(step);
    setShowWizard(true);
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
      const preserved = preserveEmbeds(files, res.files);
      setFiles(preserved);
      if (preserved !== res.files) saveFiles(preserved);
      setFeedback("");
    } finally {
      setRegenerating(false);
    }
  }

  // Cambios pedidos por chat tras el decálogo. Devuelve el mensaje de confirmación.
  async function handleChatRegenerate(fb: string): Promise<string> {
    const res = await api<{ files: Record<string, string>; truncated: boolean }>(
      `/api/landing/${id}/regenerate`,
      { method: "POST", body: JSON.stringify({ feedback: fb }) }
    );
    const preserved = preserveEmbeds(files, res.files);
    setFiles(preserved);
    if (preserved !== res.files) saveFiles(preserved);
    if (!activePath || !preserved[activePath]) {
      const first = Object.keys(preserved)[0];
      if (first) setActivePath(first);
    }
    return res.truncated
      ? "Apliqué los cambios, pero la respuesta se truncó. Revisa el editor."
      : "✓ Cambios aplicados. Míralos en el Preview.";
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

  return {
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
  };
}
