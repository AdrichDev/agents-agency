"use client";

import { useEffect, useState, useRef } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api";

interface Props {
  projectId: string;
  initialUrl: string | null;
}

/**
 * Panel de QR del landing builder.
 * URL editable y persistente; genera el QR al vuelo y permite descargarlo.
 */
export function QrPanel({ projectId, initialUrl }: Props) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Regenera el QR cada vez que cambia la URL.
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(trimmed, { width: 512, margin: 2, errorCorrectionLevel: "M" })
      .then((d) => { if (!cancelled) setDataUrl(d); })
      .catch(() => { if (!cancelled) setDataUrl(null); });
    return () => { cancelled = true; };
  }, [url]);

  function persist(value: string) {
    setSaveStatus("saving");
    api(`/api/landing/${projectId}/qr`, {
      method: "PATCH",
      body: JSON.stringify({ qrUrl: value.trim() || null }),
    })
      .then(() => {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      })
      .catch(() => setSaveStatus("error"));
  }

  function handleChange(v: string) {
    setUrl(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(v), 1000);
  }

  function download() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "landing-qr.png";
    a.click();
  }

  return (
    <div className="overflow-y-auto h-full p-4 space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="kicker">URL del QR</p>
          {saveStatus === "saving" && <span className="text-xs text-slate-400">Guardando...</span>}
          {saveStatus === "saved" && <span className="text-xs text-emerald-400">✓ Guardado</span>}
          {saveStatus === "error" && <span className="text-xs text-red-400">Error</span>}
        </div>
        <input
          className="input-dark text-sm w-full"
          placeholder="https://tu-landing.com/reservas"
          value={url}
          onChange={(e) => handleChange(e.target.value)}
        />
        <p className="text-xs text-slate-500 mt-2">
          Apunta a tu landing o a una sección: precios, reservas, cartas... Editable cuando quieras.
        </p>
      </div>

      {dataUrl ? (
        <div className="flex flex-col items-center gap-3 border-t border-white/5 pt-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dataUrl}
            alt="Código QR"
            className="w-full max-w-[220px] rounded-xl bg-white p-3"
          />
          <button className="btn-grad w-full text-xs py-2" onClick={download}>
            ⬇️ Descargar PNG
          </button>
        </div>
      ) : (
        <div className="border-t border-white/5 pt-4 text-xs text-slate-500 text-center">
          Escribe una URL para generar el QR.
        </div>
      )}
    </div>
  );
}
