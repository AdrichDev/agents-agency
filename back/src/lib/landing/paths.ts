/**
 * paths.ts — Validación de las claves del mapa `files` de una landing.
 *
 * Toda clave de `files` es una ruta relativa POSIX. Se rechazan rutas absolutas
 * (`/x`, `C:\x`, `C:/x`), cualquier segmento `..` o `.`, barras invertidas, bytes de
 * control, segmentos vacíos, `node_modules/` y más de 6 niveles: el build escribe ese
 * mapa en disco y lo comprime, así que una clave insegura sería una escritura arbitraria.
 *
 * `.env` es una clave VÁLIDA del mapa (lo escribe el SetupWizard), pero el build nunca
 * lo entrega: `isDotfilePath` marca los ficheros que empiezan por `.`.
 *
 * Módulo puro, sin I/O.
 */

/** Profundidad máxima de una ruta del mapa (6 niveles, 7 rechazado). */
export const MAX_FILE_PATH_DEPTH = 6;

// Bytes de control (C0 y DEL): nunca forman parte de una ruta legítima.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// Letra de unidad Windows (`C:`), también tras normalizar separadores.
const WINDOWS_DRIVE = /^[A-Za-z]:/;

// `__proto__` & co. would be silently lost when the map is rebuilt as a plain object.
const FORBIDDEN_SEGMENTS = new Set(["", ".", "..", "node_modules", "__proto__", "constructor", "prototype"]);

// Windows device names: writing `con` or `aux.html` to disk fails or hits the device.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** Filesystem limits: per segment (NAME_MAX) and whole path. */
const MAX_SEGMENT_LENGTH = 255;
const MAX_PATH_LENGTH = 512;

/** Windows trims trailing dots/spaces (`x.` aliases `x`); a leading space is never intended. */
function isPortableSegment(segment: string): boolean {
  if (segment.length > MAX_SEGMENT_LENGTH) return false;
  if (/[. ]$/.test(segment) || segment.startsWith(" ")) return false;
  return !WINDOWS_RESERVED.test(segment);
}

/**
 * True si `path` es una ruta relativa POSIX segura para el mapa de ficheros.
 * No juzga el contenido, solo la clave.
 */
export function isSafeFilePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  if (CONTROL_CHARS.test(path)) return false;
  if (path.includes("\\")) return false;
  if (path.startsWith("/")) return false;
  if (WINDOWS_DRIVE.test(path)) return false;

  const segments = path.split("/");
  if (segments.length > MAX_FILE_PATH_DEPTH) return false;

  return segments.every(
    (segment) => !FORBIDDEN_SEGMENTS.has(segment.toLowerCase()) && isPortableSegment(segment)
  );
}

/**
 * True si algún segmento de `path` empieza por `.` (`.env`, `assets/.hidden`). El build
 * excluye siempre estos ficheros de la entrega.
 */
export function isDotfilePath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

export interface FilterSafeFilesResult {
  /** Claves válidas, en el orden original. */
  files: Record<string, string>;
  /** Claves descartadas, en el orden original. */
  dropped: string[];
}

/**
 * Descarta las claves inseguras de un mapa `files`. El mapa de entrada no se muta y
 * `dropped` queda vacío cuando todas las claves son válidas.
 */
export function filterSafeFiles(files: Record<string, string>): FilterSafeFilesResult {
  const safe: Record<string, string> = {};
  const dropped: string[] = [];

  for (const [path, content] of Object.entries(files)) {
    if (isSafeFilePath(path)) {
      safe[path] = content;
    } else {
      dropped.push(path);
    }
  }

  return { files: safe, dropped };
}
