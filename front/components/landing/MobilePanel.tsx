"use client";

import { useState } from "react";
import { api } from "@/lib/api";

interface Props {
  projectId: string;
  files: Record<string, string>;
  mobileFiles: Record<string, string>;
  onMobileGenerated: (mobileFiles: Record<string, string>, stack: string) => void;
}

export function MobilePanel({ projectId, files, mobileFiles, onMobileGenerated }: Props) {
  const [stack, setStack] = useState<"expo" | "flutter">("expo");
  const [generatingAndroid, setGeneratingAndroid] = useState(false);
  const [generatingIos, setGeneratingIos] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(target: "android" | "ios") {
    const setGenerating = target === "android" ? setGeneratingAndroid : setGeneratingIos;
    setGenerating(true);
    setError(null);
    try {
      const res = await api<{ mobileFiles: Record<string, string>; truncated: boolean; error?: string }>(
        `/api/landing/${projectId}/mobile`,
        {
          method: "POST",
          body: JSON.stringify({ stack, target }),
        }
      );
      if (res.error) { setError(res.error); return; }
      onMobileGenerated(res.mobileFiles, stack);
    } catch {
      setError("Error al generar la app móvil.");
    } finally {
      setGenerating(false);
    }
  }

  async function downloadZip(type: "landing" | "mobile") {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const filesToZip = type === "landing" ? files : mobileFiles;
    const prefix = type === "landing" ? "landing" : `mobile-${stack}`;

    for (const [path, content] of Object.entries(filesToZip)) {
      zip.file(path, content);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${prefix}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasLanding = Object.keys(files).length > 0;
  const hasMobile = Object.keys(mobileFiles).length > 0;

  return (
    <div className="p-4 flex flex-col gap-4">
      <div>
        <p className="kicker mb-3">App Móvil</p>

        {/* Stack selector */}
        <div className="flex gap-2 mb-4">
          <button
            className={`flex-1 text-sm py-2 rounded-xl border transition ${
              stack === "expo"
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20"
            }`}
            onClick={() => setStack("expo")}
          >
            Expo (RN)
          </button>
          <button
            className={`flex-1 text-sm py-2 rounded-xl border transition ${
              stack === "flutter"
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20"
            }`}
            onClick={() => setStack("flutter")}
          >
            Flutter
          </button>
        </div>

        {/* Generate buttons */}
        <div className="flex gap-2">
          <button
            className="btn-grad flex-1 text-xs py-2"
            onClick={() => generate("android")}
            disabled={generatingAndroid || generatingIos}
          >
            {generatingAndroid ? "Generando..." : "🤖 Android"}
          </button>
          <button
            className="btn-grad flex-1 text-xs py-2"
            onClick={() => generate("ios")}
            disabled={generatingAndroid || generatingIos}
          >
            {generatingIos ? "Generando..." : " iOS"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      {/* Download section */}
      <div>
        <p className="kicker mb-3">Descargar</p>
        <div className="flex flex-col gap-2">
          <button
            className={`btn-dark text-xs py-2 flex items-center justify-center gap-2 ${!hasLanding ? "opacity-40 cursor-not-allowed" : ""}`}
            onClick={() => hasLanding && downloadZip("landing")}
            disabled={!hasLanding}
          >
            📦 Descargar landing.zip
          </button>
          <button
            className={`btn-dark text-xs py-2 flex items-center justify-center gap-2 ${!hasMobile ? "opacity-40 cursor-not-allowed" : ""}`}
            onClick={() => hasMobile && downloadZip("mobile")}
            disabled={!hasMobile}
          >
            📱 Descargar mobile.zip
          </button>
        </div>
        {!hasLanding && (
          <p className="text-xs text-slate-500 mt-2">Genera la landing primero para descargar</p>
        )}
      </div>
    </div>
  );
}
