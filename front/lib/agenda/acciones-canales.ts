// Acciones comerciales y canales predefinidos para la sección "Acción y Canal"
// del modal de alta de citas (paridad UX con creador_CRM/front/components/crm/
// nueva-cita-modal.tsx). AA no tiene columnas dedicadas para esto: el resultado
// se pliega en `notes` vía buildCitaNotes.
export const ACCIONES_COMERCIALES: string[] = [
  "Visita comercial",
  "Llamada de seguimiento",
  "Reunión",
  "Demostración de producto",
  "Presentación de presupuesto",
  "Firma de contrato",
  "Prospección",
  "Visita de cortesía",
];

export const CANALES: string[] = ["Presencial", "Videollamada", "Llamada"];

/**
 * Construye el string canónico de `notes` a partir de Acción/Canal/Comentarios.
 * Formato fijo: segmentos ` | `-separados, en orden Acción → Canal → Comentarios,
 * cada uno opcional (se omite si está vacío). Réplica exacta de la lógica de
 * plegado de creador_CRM (buildCitaNotes): cualquier `|` literal dentro de un
 * segmento se colapsa a `/` para no romper el separador.
 */
export function buildCitaNotes(
  accion?: string,
  canal?: string,
  comentarios?: string,
): string {
  const clean = (s: string) => s.trim().replace(/\s*\|\s*/g, " / ");
  const parts: [string, string][] = [
    ["Acción", clean(accion ?? "")],
    ["Canal", clean(canal ?? "")],
    ["Comentarios", clean(comentarios ?? "")],
  ];
  return parts
    .filter(([, v]) => v)
    .map(([label, v]) => `${label}: ${v}`)
    .join(" | ");
}

/**
 * Separa el segmento `Comercial: <nombre>` (si existe) del resto de `notes`.
 * Usado por el modal de detalle (cita-detalle-modal.tsx) para que la caja de
 * Anotaciones NUNCA muestre/edite el comercial plegado por el modal de alta,
 * sin perder el dato: `joinComercial` lo vuelve a anteponer al guardar.
 */
export function splitComercial(notes?: string | null): { comercial: string; anotaciones: string } {
  if (!notes) return { comercial: "", anotaciones: "" };
  const segmentos = notes.split("|").map((s) => s.trim());
  const idx = segmentos.findIndex((s) => /^comercial\s*:/i.test(s));
  if (idx === -1) return { comercial: "", anotaciones: notes.trim() };
  const comercial = segmentos[idx];
  const anotaciones = segmentos.filter((_, i) => i !== idx).join(" | ");
  return { comercial, anotaciones };
}

/** Inverso de `splitComercial`: recompone `notes` anteponiendo el segmento Comercial. */
export function joinComercial(comercial: string, anotaciones: string): string {
  return [comercial, anotaciones]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" | ");
}
