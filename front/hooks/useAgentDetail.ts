"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, API, getToken } from "@/lib/api";
import { useDialogs } from "@/components/ui/ConfirmProvider";

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
 * Estado + fetch de la página de detalle de un agente (carga del agente, fuentes
 * RAG, ingesta por URL y subida de archivos). Extraído de la página; el
 * comportamiento de red es idéntico al inline previo, incluido el upload con
 * Bearer por fetch crudo (no usa api() porque fuerza Content-Type JSON).
 */
export function useAgentDetail() {
  const { confirm } = useDialogs();
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const [agent, setAgent] = useState<any>(null);
  const [tab, setTab] = useState<string>(search.get("tab") ?? "chat");
  const [kbUrl, setKbUrl] = useState("");
  const [kbStatus, setKbStatus] = useState("");
  const [sources, setSources] = useState<KbSource[]>([]);
  const [fileList, setFileList] = useState<FileList | null>(null);
  const [fileResults, setFileResults] = useState<KbFileResult[]>([]);
  const [fileUploading, setFileUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api(`/api/agents/${id}`).then(setAgent).catch(() => setAgent({ error: true }));
  }, [id]);

  const loadSources = useCallback(() => {
    api<{ sources: KbSource[] }>(`/api/knowledge/${id}/sources`)
      .then((d) => setSources(d.sources))
      .catch(() => setSources([]));
  }, [id]);

  useEffect(load, [load]);
  useEffect(loadSources, [loadSources]);

  async function deleteSource(source: string) {
    const ok = await confirm({
      title: "Borrar fuente",
      message: `¿Borrar todos los chunks indexados de "${source}"?`,
      confirmText: "Borrar",
      cancelText: "Cancelar",
    });
    if (!ok) return;
    await api(`/api/knowledge/${id}/sources`, {
      method: "DELETE",
      body: JSON.stringify({ source }),
    });
    loadSources();
    load();
  }

  /** Ingesta por URL. `urlOverride` permite re-ingestar la "web inicial" (F5). */
  async function ingest(urlOverride?: string) {
    const url = urlOverride ?? kbUrl;
    if (!url) return;
    setKbStatus("Scrapeando e indexando…");
    let data = await api<any>("/api/knowledge", {
      method: "POST",
      body: JSON.stringify({ agentId: id, url }),
    });
    if (data.requiresConfirmation) {
      const overwriteDuplicates = await confirm({
        title: "Chunks duplicados",
        message: `Hay ${data.duplicates} chunks duplicados. ¿Quieres sobrescribirlos?`,
        confirmText: "Sobrescribir",
        cancelText: "Cancelar",
      });
      data = await api<any>("/api/knowledge", {
        method: "POST",
        body: JSON.stringify({ agentId: id, url, overwriteDuplicates }),
      });
    }
    setKbStatus(
      data.chunks != null
        ? `✓ ${data.chunks} chunks indexados de ${data.pages ?? 1} páginas`
        : `Error: ${data.error}`
    );
    setKbUrl("");
    load();
    loadSources();
  }

  async function uploadFiles(overwriteDuplicates?: boolean) {
    if (!fileList || fileList.length === 0) return;
    setFileUploading(true);
    setFileResults([]);
    try {
      const formData = new FormData();
      for (const file of Array.from(fileList)) {
        formData.append("files", file);
      }
      if (overwriteDuplicates !== undefined) {
        formData.append("overwriteDuplicates", String(overwriteDuplicates));
      }

      // Raw fetch — do NOT use api() helper (it forces Content-Type: application/json).
      // No fijamos Content-Type: el browser pone el boundary multipart automáticamente.
      const token = await getToken();
      const res = await fetch(`${API}/api/knowledge/${id}/files`, {
        method: "POST",
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      const data: {
        files: KbFileResult[];
        requiresConfirmation: boolean;
      } = await res.json();

      if (!res.ok) {
        setFileResults([{ source: "error", chunks: 0, duplicates: 0, note: (data as any).error ?? `Error ${res.status}` }]);
        return;
      }

      if (data.requiresConfirmation) {
        const overwrite = await confirm({
          title: "Chunks duplicados",
          message: `Hay archivos con chunks duplicados. ¿Quieres sobrescribirlos?`,
          confirmText: "Sobrescribir",
          cancelText: "Cancelar",
        });
        // Re-POST with resolved policy.
        await uploadFiles(overwrite);
        return;
      }

      setFileResults(data.files);
      // Reset file input.
      setFileList(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadSources();
      load();
    } finally {
      setFileUploading(false);
    }
  }

  return {
    id,
    agent,
    tab, setTab,
    kbUrl, setKbUrl,
    kbStatus,
    sources,
    fileList, setFileList,
    fileResults,
    fileUploading,
    fileInputRef,
    load,
    deleteSource,
    ingest,
    uploadFiles,
  };
}
