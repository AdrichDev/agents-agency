"use client";

import { useRef, useState } from "react";
import type { LandingReference } from "./types";

/** El backend rechaza `file.content` por encima de 1.000.000 caracteres. */
const MAX_FILE_CHARS = 1_000_000;

interface Props {
  /** Mientras hay una petición en vuelo, no se puede lanzar otra referencia. */
  disabled?: boolean;
  onApply: (reference: LandingReference) => void;
}

/**
 * Pauta de diseño opcional en el chat del decálogo: un enlace público o un
 * fichero HTML. Solo se envían al backend, que extrae estructura, paleta y
 * tipografías; nunca se copian textos, imágenes ni logo.
 */
export function ReferencePicker({ disabled, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function submitUrl() {
    const value = url.trim();
    if (!/^https?:\/\/\S+$/i.test(value)) {
      setError("Escribe una URL válida que empiece por http:// o https://.");
      return;
    }
    setError(null);
    onApply({ url: value });
  }

  async function handleFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    // El backend solo entiende HTML; se descarta antes de leer o enviar nada.
    if (!/\.html?$/i.test(file.name)) {
      setError("Solo se admiten ficheros HTML (.html, .htm).");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const content = await file.text();
    if (content.length > MAX_FILE_CHARS) {
      setError("El fichero es demasiado grande (máximo 1 MB de HTML).");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setError(null);
    onApply({ file: { name: file.name, content } });
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="mb-2">
      <button
        className="btn-dark px-3 py-1.5 text-xs"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
      >
        {open ? "Ocultar referencia" : "Añadir referencia"}
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-2 space-y-2">
          <p className="text-[11px] text-slate-500">
            Opcional: usa una web o un HTML como pauta de estilo.
          </p>
          <div className="flex gap-2">
            <input
              className="input-dark flex-1 text-xs"
              placeholder="https://ejemplo.com"
              aria-label="URL de referencia"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitUrl();
                }
              }}
              disabled={disabled}
            />
            <button className="btn-dark px-3 py-1.5 text-xs" onClick={submitUrl} disabled={disabled}>
              Usar enlace
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".html,.htm"
              className="hidden"
              aria-label="Fichero HTML de referencia"
              onChange={(e) => handleFile(e.target.files)}
              disabled={disabled}
            />
            <button
              className="btn-dark px-3 py-1.5 text-xs"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
            >
              Usar fichero HTML
            </button>
            <span className="text-[11px] text-slate-500">.html o .htm</span>
          </div>

          <p className="text-[11px] text-slate-500">
            Solo se usan como pauta: no se copian textos, imágenes ni logo.
          </p>

          {error && <p className="text-[11px] text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
