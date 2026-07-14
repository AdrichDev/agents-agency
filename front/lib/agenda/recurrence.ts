// Recurrencia de citas (aa-agenda, paridad con creador_CRM S4): modelo "generar N
// ocurrencias acotadas". Una cita recurrente se expande en el front a N citas
// independientes (cada una se crea vía onSave/POST normal). Este helper solo calcula
// las FECHAS de las ocurrencias; la hora es la misma.

export type RepeticionFreq = "puntual" | "diaria" | "mensual" | "anual";

export const REPETICIONES: { id: RepeticionFreq; label: string }[] = [
  { id: "puntual", label: "Puntual (una vez)" },
  { id: "diaria", label: "Diaria" },
  { id: "mensual", label: "Mensual" },
  { id: "anual", label: "Anual" },
];

/** Cap defensivo: nunca generar más de esta cantidad de ocurrencias en una serie. */
export const RECURRENCE_CAP = 60;

function daysInMonth(y: number, m: number): number {
  // m 1-based; día 0 del mes siguiente = último día de este mes.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Fechas 'YYYY-MM-DD' de las N ocurrencias desde `baseFecha` según la frecuencia.
 * `count` incluye la primera. 'puntual' → solo la base. Acotado por RECURRENCE_CAP.
 * Mensual/anual hacen clamp al último día del mes si el día desborda (p.ej. 31 ene
 * + 1 mes → 28/29 feb; 29 feb anual → 28 feb en año no bisiesto).
 */
export function recurrenceDates(
  baseFecha: string,
  freq: RepeticionFreq,
  count: number,
  cap: number = RECURRENCE_CAP,
): string[] {
  if (!baseFecha) return [];
  const n = freq === "puntual" ? 1 : Math.max(1, Math.min(Math.floor(count), cap));
  const [y, m, d] = baseFecha.split("-").map(Number);
  if (!y || !m || !d) return [];

  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let yy = y;
    let mm = m;
    let dd = d;
    if (freq === "diaria") {
      const base = new Date(Date.UTC(y, m - 1, d));
      base.setUTCDate(base.getUTCDate() + i);
      yy = base.getUTCFullYear();
      mm = base.getUTCMonth() + 1;
      dd = base.getUTCDate();
    } else if (freq === "mensual") {
      const totalMonth = (m - 1) + i;
      yy = y + Math.floor(totalMonth / 12);
      mm = (totalMonth % 12) + 1;
      dd = Math.min(d, daysInMonth(yy, mm));
    } else if (freq === "anual") {
      yy = y + i;
      mm = m;
      dd = Math.min(d, daysInMonth(yy, mm));
    }
    out.push(`${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`);
  }
  return out;
}
