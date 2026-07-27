/**
 * Generador del espejo del catálogo de precios (aa-catalogo-precios-fuente-unica, T2.1).
 *
 * El precio vive en un único fichero, `front/lib/service-catalog.json`. El back no puede importarlo ni
 * leerlo en producción: front y back son paquetes con deploys separados (Vercel con root `front/`,
 * Render con root `back/`) y lo que queda fuera de cada root no viaja en el bundle. Por eso el back
 * lleva un espejo generado y commiteado, y un test compara el fichero en disco con la salida de
 * `renderCatalogModule` para que no puedan derivar.
 *
 * El render tiene que ser determinista byte a byte —campos en orden fijo, sin fechas, sin
 * `JSON.stringify` de objetos— precisamente porque ese test compara texto. Un generador que produce
 * dos salidas distintas para la misma entrada convierte el tripwire en un falso rojo permanente.
 *
 * Vive en `scripts/` y no en `src/`: no es código de runtime, es una herramienta de repo. El
 * `tsconfig.json` del back no incluye este directorio, pero el test que lo importa sí lo mete en el
 * programa de `tsc`, así que se comprueba de tipos igual.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface CatalogServiceSource {
  id: string;
  name: string;
  description: string;
  /** Puesta en marcha, pago único, sin IVA. */
  implPrice: number;
  /** Mensualidad, sin IVA. */
  maintPrice: number;
  /** Si el plan incluye el cupo mensual de tokens. El número está una sola vez, en `planTokens`. */
  includesPlanTokens: boolean;
}

export interface CatalogSource {
  planTokens: number;
  ivaRate: number;
  services: CatalogServiceSource[];
}

/** Fichero canónico. Ruta relativa a este script, no al directorio de trabajo. */
export const CATALOG_JSON_PATH = fileURLToPath(
  new URL("../../front/lib/service-catalog.json", import.meta.url)
);

/** Destino del espejo generado. */
export const GENERATED_MODULE_PATH = fileURLToPath(
  new URL("../src/lib/service-catalog.ts", import.meta.url)
);

/**
 * Lee y valida el catálogo canónico. Revienta en vez de devolver algo vacío: este fichero decide lo
 * que se cobra, y un generador que produce un catálogo de cero servicios sin quejarse dejaría al back
 * sin precios y al test de deriva pasando en verde sobre la nada.
 */
export function readCatalogSource(): CatalogSource {
  const raw = readFileSync(CATALOG_JSON_PATH, "utf8");
  const parsed = JSON.parse(raw) as CatalogSource;

  if (!Number.isFinite(parsed.planTokens) || parsed.planTokens <= 0) {
    throw new Error("service-catalog.json: `planTokens` tiene que ser un número positivo");
  }
  if (!Number.isFinite(parsed.ivaRate) || parsed.ivaRate < 0) {
    throw new Error("service-catalog.json: `ivaRate` tiene que ser un número no negativo");
  }
  if (!Array.isArray(parsed.services) || parsed.services.length === 0) {
    throw new Error("service-catalog.json: `services` no puede estar vacío");
  }

  const seen = new Set<string>();
  for (const s of parsed.services) {
    if (!s.id || typeof s.id !== "string") {
      throw new Error("service-catalog.json: hay un servicio sin `id`");
    }
    if (seen.has(s.id)) {
      // Los ids son la clave con la que las líneas de presupuesto y (en H6) los precios de Stripe
      // apuntan al catálogo. Duplicado significa que un `find` devuelve el que no toca.
      throw new Error(`service-catalog.json: id duplicado \`${s.id}\``);
    }
    seen.add(s.id);

    if (!s.name || !s.description) {
      throw new Error(`service-catalog.json: \`${s.id}\` sin nombre o sin descripción`);
    }
    for (const campo of ["implPrice", "maintPrice"] as const) {
      const v = s[campo];
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(`service-catalog.json: \`${s.id}.${campo}\` no es un importe válido`);
      }
    }
    if (typeof s.includesPlanTokens !== "boolean") {
      // Tiene que estar en todas las entradas, incluidas las `false`: con `resolveJsonModule`, un campo
      // presente solo en algunas hace que TypeScript infiera una unión y el front no compile.
      throw new Error(`service-catalog.json: \`${s.id}.includesPlanTokens\` tiene que ser booleano`);
    }
  }

  return parsed;
}

/**
 * Normaliza saltos de línea antes de comparar textos.
 *
 * El repo está con `core.autocrlf=true` y sin `.gitattributes`: el generador escribe LF, pero el
 * siguiente checkout en Windows devuelve el fichero con CRLF. Comparar en crudo daría rojo en un clon
 * limpio sin que nadie haya tocado un precio — el tripwire tiene que detectar deriva de contenido, no
 * de final de línea.
 */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Literal de cadena para TypeScript. `JSON.stringify` ya escapa comillas y barras. */
function str(v: string): string {
  return JSON.stringify(v);
}

const HEADER = `// FICHERO GENERADO — no editar a mano.
// Fuente: front/lib/service-catalog.json · regenerar con \`npm run catalog:sync\`.
//
// El precio se cambia en ese JSON y en ningún otro sitio. Este espejo existe porque front y back son
// paquetes con deploys separados y el back no puede leer el fichero del front en producción. Hay un
// test (\`tests/catalogo-precios-fuente-unica.test.ts\`) que compara este fichero con la salida del
// generador: editarlo a mano, o cambiar el JSON sin regenerar, sale en rojo.

export interface ServiceEntry {
  id: string;
  name: string;
  description: string;
  /** Puesta en marcha, pago único, sin IVA. */
  implPrice: number;
  /** Mensualidad, sin IVA. */
  maintPrice: number;
  /** Cupo mensual de tokens incluido, o \`null\` si el servicio no lleva agente. */
  tokens: number | null;
}`;

/**
 * Renderiza el módulo del back a partir del catálogo canónico. Puro: misma entrada, mismo texto.
 */
export function renderCatalogModule(source: CatalogSource): string {
  const rows = source.services
    .map((s) => {
      const tokens = s.includesPlanTokens ? String(source.planTokens) : "null";
      return (
        `  { id: ${str(s.id)}, name: ${str(s.name)}, description: ${str(s.description)}, ` +
        `implPrice: ${String(s.implPrice)}, maintPrice: ${String(s.maintPrice)}, tokens: ${tokens} },`
      );
    })
    .join("\n");

  return `${HEADER}

/** Catálogo oficial 2026. Precios SIN IVA. Orden y contenido calcados del JSON del front. */
export const SERVICE_CATALOG: ServiceEntry[] = [
${rows}
];
`;
}
