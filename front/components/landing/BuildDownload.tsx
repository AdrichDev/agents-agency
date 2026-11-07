"use client";

import { useState } from "react";
import { apiBlob, ApiError } from "@/lib/api";

/** Vías de build del backend (`{ mode?: "static" | "tailwind" | "next" }`). */
type BuildMode = "auto" | "static" | "tailwind" | "next";

const MODES: { value: BuildMode; label: string }[] = [
  { value: "auto", label: "Automática" },
  { value: "static", label: "Estático" },
  { value: "tailwind", label: "Tailwind compilado" },
  { value: "next", label: "Next" },
];

const NEXT_BUILDER_COMMAND = "npm run landing:next-image";

/** Cola acotada del stderr del build de Next (ya viene saneado por el backend). */
const STDERR_TAIL_LINES = 3;
const STDERR_TAIL_CHARS = 400;

function tail(text: string): string {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const joined = lines.slice(-STDERR_TAIL_LINES).join(" · ");
  return joined.length > STDERR_TAIL_CHARS ? `${joined.slice(0, STDERR_TAIL_CHARS)}…` : joined;
}

/**
 * Traduce el error del endpoint de build a algo accionable. El backend manda
 * `{ error, code, details? }`; el `code` es el contrato estable (S1/S4/S6/S8), así que
 * se mapea por código y no por el texto del mensaje.
 */
function mensajeDeError(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return "No se pudo descargar el build. Inténtalo de nuevo.";
  }

  const code = typeof err.body?.code === "string" ? err.body.code : null;
  const details = err.body?.details ?? {};

  switch (code) {
    case "NOTHING_TO_BUILD":
      return "No hay index.html que construir. Genera la landing antes de descargar el build.";
    case "IMAGE_UNAVAILABLE":
      return typeof details.url === "string" && details.url
        ? `No se pudo descargar una imagen: ${details.url}`
        : "No se pudo descargar una imagen de la landing.";
    case "TAILWIND_REQUIRES_COMPILE":
      return "Esta landing usa el CDN de Tailwind. Elige la vía «Tailwind compilado» o «Automática».";
    case "TAILWIND_CONFIG_UNSUPPORTED":
      return "La configuración de Tailwind de esta landing no se puede interpretar. Corrígela o usa la vía «Automática».";
    case "TAILWIND_COMPILE_FAILED":
      return "No se pudo compilar Tailwind. Revisa el HTML de la landing e inténtalo de nuevo.";
    case "BUILD_INPUT_TOO_LARGE":
      return "La landing es demasiado grande para compilar Tailwind (máximo 1 MB entre HTML y script.js).";
    case "NEXT_BUILDER_UNAVAILABLE":
      return `El constructor de Next no está disponible. Ejecuta \`${NEXT_BUILDER_COMMAND}\` en back/ (requiere Docker).`;
    case "NEXT_BUILD_FAILED": {
      const stderr = typeof details.stderr === "string" ? tail(details.stderr) : "";
      return stderr
        ? `No se pudo compilar el proyecto Next: ${stderr}`
        : "No se pudo compilar el proyecto Next. Prueba otra vía de build.";
    }
    case "NEXT_BUILD_TIMEOUT":
      return "El build de Next superó el tiempo máximo (180 s). Vuelve a intentarlo o usa otra vía de build.";
    case "VALIDATION_ERROR":
      return "La vía de build seleccionada no es válida.";
    default:
      break;
  }

  // El limitador responde 429 sin `code`.
  if (err.status === 429) {
    return "Demasiadas peticiones seguidas. Espera unos segundos y vuelve a intentarlo.";
  }
  if (err.status === 404) {
    return "No encontramos esta landing.";
  }
  const servidor = typeof err.message === "string" ? err.message.trim() : "";
  return servidor ? `No se pudo descargar el build: ${servidor}` : "No se pudo descargar el build. Inténtalo de nuevo.";
}

/** Dispara la descarga del blob con el nombre que indicó el servidor. */
function descargarBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * "Descargar build" (S9): pide el ZIP al backend con la vía elegida y lo entrega con
 * el nombre que manda el servidor. El ZIP que se generaba en el navegador no respetaba
 * la carpeta raíz por landing del contrato, así que se retiró.
 */
export function BuildDownload({ projectId }: { projectId: string }) {
  const [mode, setMode] = useState<BuildMode>("auto");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El build de Next compila en un contenedor (~20 s): el texto lo dice para que la
  // espera no parezca un cuelgue.
  const progreso =
    mode === "next" ? "Construyendo con Next (puede tardar ~20 s)…" : "Construyendo…";

  async function descargar() {
    setRunning(true);
    setError(null);
    try {
      const res = await apiBlob(`/api/landing/${projectId}/build`, {
        method: "POST",
        // Sin vía elegida no se manda `mode`: el backend resuelve la vía leyendo el HTML
        // (CDN de Tailwind → tailwind, si no static).
        body: JSON.stringify(mode === "auto" ? {} : { mode }),
      });
      descargarBlob(res.blob, res.filename ?? "landing.zip");
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <label htmlFor="build-via" className="kicker mb-2 block">
        Vía de build
      </label>
      <select
        id="build-via"
        className="input-dark text-xs mb-2"
        value={mode}
        onChange={(e) => setMode(e.target.value as BuildMode)}
        disabled={running}
      >
        {MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>

      <button
        className="btn-grad w-full text-xs py-2 flex items-center justify-center gap-2"
        onClick={descargar}
        disabled={running}
      >
        Descargar build
      </button>

      {running && (
        <p role="status" className="text-xs text-slate-400 mt-2">
          {progreso}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-xl px-3 py-2 mt-2"
        >
          {error}
        </p>
      )}
    </div>
  );
}
