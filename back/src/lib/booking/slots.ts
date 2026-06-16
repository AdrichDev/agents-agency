import { DateTime } from "luxon";

/**
 * Parsea horario "09:00-18:00" o "09:00-13:00|14:00-18:00" (con descanso).
 * Retorna array de {start, end} en minutos desde medianoche.
 */
export function parseScheduleRange(rangeStr: string): Array<{ start: number; end: number }> {
  const blocks = rangeStr.split("|");
  return blocks.map((block) => {
    const [start, end] = block.trim().split("-").map((t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    });
    return { start, end };
  });
}

/**
 * Obtiene los rangos horarios para un día específico (ej: "lunes").
 */
export function getScheduleForDay(
  schedule: Record<string, string>,
  date: DateTime
): Array<{ start: number; end: number }> | null {
  const dayName = date.toFormat("EEEE").toLowerCase();
  const rangeStr = schedule[dayName];
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

            slots.push({
              startTime: slotStart.toISO()!,
              endTime: slotEnd.toISO()!,
            });

            minute += 30; // próximo slot cada 30 min (o configurable)
          }
        }
      }
    }
    current = current.plus({ days: 1 });
  }

  return slots;
}
