import { DateTime } from "luxon";

/**
 * Parsea horario "09:00-18:00" o "09:00-13:00|14:00-18:00" (con descanso).
 * Retorna array de {start, end} en minutos desde medianoche.
 */
function parseScheduleRange(rangeStr: string): Array<{ start: number; end: number }> {
  const blocks = rangeStr.split("|");
  return blocks.map((block) => {
    const [start, end] = block.trim().split("-").map((t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    });
    return { start, end };
  });
}

/** Indexadas por `DateTime.weekday % 7` (luxon: 1=lunes … 7=domingo). */
const DAY_KEYS_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_KEYS_LONG = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * Obtiene los rangos horarios de un día.
 *
 * El horario se persiste con claves de tres letras (`{ mon: "09:00-18:00" }`, ver
 * `AgentSchedule.schedule` en el schema), pero esto buscaba `date.toFormat("EEEE")`, es
 * decir `"monday"`. Ninguna clave casaba NUNCA: `computeAvailableSlots` devolvía cero
 * huecos para todos los agentes, así que la reserva por el camino correcto era imposible.
 * Los tests no lo vieron porque montaban el horario con la clave larga que esperaba el
 * código, no con la que escribe el producto.
 *
 * Se acepta forma corta y larga, e ir por el índice del día evita además depender del
 * locale de luxon (con `es` el formato daría "miércoles").
 */
function getScheduleForDay(
  schedule: Record<string, string>,
  date: DateTime
): Array<{ start: number; end: number }> | null {
  const idx = date.weekday % 7;
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(schedule)) normalized[k.trim().toLowerCase()] = v;

  const rangeStr = normalized[DAY_KEYS_SHORT[idx]] ?? normalized[DAY_KEYS_LONG[idx]];
  if (!rangeStr) return null;
  return parseScheduleRange(rangeStr);
}

/**
 * Genera slots disponibles para un servicio en un rango de fechas.
 * @param startDate - inicio (inclusive)
 * @param endDate - fin (inclusive)
 * @param duration - duración del slot en minutos
 * @param schedule - horarios del agente { mon: "09:00-18:00", ... }
 * @param timezone - zona horaria (ej "Europe/Madrid")
 * @param blocked - fechas bloqueadas [{ startDate, endDate }, ...]
 * @returns slots: [{ startTime: ISO, endTime: ISO }, ...]
 */
export function generateSlots(
  startDate: Date,
  endDate: Date,
  duration: number,
  schedule: Record<string, string>,
  timezone: string,
  blocked: Array<{ startDate: Date; endDate: Date }>
): Array<{ startTime: string; endTime: string }> {
  const slots: Array<{ startTime: string; endTime: string }> = [];
  const tz = DateTime.fromJSDate(startDate, { zone: timezone });
  const end = DateTime.fromJSDate(endDate, { zone: timezone });

  const blockedSet = new Set<string>();
  for (const block of blocked) {
    let d = DateTime.fromJSDate(block.startDate, { zone: timezone }).startOf("day");
    const blockEnd = DateTime.fromJSDate(block.endDate, { zone: timezone }).startOf("day");
    while (d <= blockEnd) {
      blockedSet.add(d.toISODate()!);
      d = d.plus({ days: 1 });
    }
  }

  let current = tz.startOf("day");
  while (current <= end) {
    const isoDate = current.toISODate()!;
    if (!blockedSet.has(isoDate)) {
      const ranges = getScheduleForDay(schedule, current);
      if (ranges) {
        for (const range of ranges) {
          let minute = range.start;
          while (minute + duration <= range.end) {
            const slotStart = current.set({ hour: Math.floor(minute / 60), minute: minute % 60 });
            const slotEnd = slotStart.plus({ minutes: duration });

            // El barrido arranca en `startOf("day")`, así que sin este filtro se ofrecen
            // huecos ya pasados: consultando a las 23:20 aparecía "hoy a las 09:00".
            if (slotStart >= tz) {
              slots.push({
                startTime: slotStart.toISO()!,
                endTime: slotEnd.toISO()!,
              });
            }

            minute += 30; // próximo slot cada 30 min (o configurable)
          }
        }
      }
    }
    current = current.plus({ days: 1 });
  }

  return slots;
}
