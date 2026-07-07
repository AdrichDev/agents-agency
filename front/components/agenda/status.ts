/**
 * Estados de cita y helpers de color (paridad con OperaOS
 * creador_CRM/front/components/agenda/shared.tsx), traducidos a tokens AA:
 * `var(--acc)` → `var(--accent-1)`. Conviven con `statusTone` de
 * agenda-fullscreen.ts (clases Tailwind border-l-*, usadas por la page actual
 * hasta P3): `estadoTone` es el color canónico OperaOS para estilo inline
 * (`style={{ borderLeftColor }}`), que P3 adoptará al reescribir la page.
 */

export const APPOINTMENT_STATUSES = [
  "Pendiente",
  "Confirmada",
  "Completada",
  "Cancelada",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Color del borde izquierdo de la tarjeta según estado de cita. */
export const estadoTone = (s: string): string =>
  s === "Completada" ? "#6aa8ff" : s === "Cancelada" ? "#ff4757" : "var(--accent-1)";

export type Tone = "green" | "amber" | "blue" | "red";

/** Tono del badge según estado. */
export const tone = (s: string): Tone =>
  s === "Confirmada" ? "green" : s === "Pendiente" ? "amber" : s === "Completada" ? "blue" : "red";

// Clases Tailwind por tono, siguiendo la gramática de pill de AA
// (components/ui/Badge.tsx: bg-X/15 text-X border-X/40).
const TONE_CLASSES: Record<Tone, string> = {
  green: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  amber: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  blue: "bg-sky-500/15 text-sky-400 border-sky-500/40",
  red: "bg-red-500/15 text-red-400 border-red-500/40",
};

/** Clases de color del badge de estado (equivalente AA del `Badge tone=` de OperaOS). */
export function toneClass(s: string): string {
  return TONE_CLASSES[tone(s)];
}
