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
export function getScheduleForDay(
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

/** Orden de lectura humano (lunes primero) y su etiqueta en castellano. */
const DIAS_HUMANOS: Array<{ clave: string; larga: string; etiqueta: string }> = [
  { clave: "mon", larga: "monday", etiqueta: "L" },
  { clave: "tue", larga: "tuesday", etiqueta: "M" },
  { clave: "wed", larga: "wednesday", etiqueta: "X" },
  { clave: "thu", larga: "thursday", etiqueta: "J" },
  { clave: "fri", larga: "friday", etiqueta: "V" },
  { clave: "sat", larga: "saturday", etiqueta: "S" },
  { clave: "sun", larga: "sunday", etiqueta: "D" },
];

/**
 * Resume un horario en una línea legible: `"L-S 20:00-22:45"`, `"L-V 13:30-15:45, D 13:30-16:00"`.
 *
 * Existe porque `listar_servicios` solo devolvía nombre y duración: nada le decía al modelo
 * QUÉ TURNO cubre cada servicio, así que ante "mesa para las 21:00" elegía "Comida" y
 * `consultar_disponibilidad` respondía, con razón, que no había hueco — el usuario leía
 * "no hay mesa a las 21:00" cuando la cena estaba entera libre.
 *
 * Los días sin franja se omiten: no aparecer ES estar cerrado. Los días consecutivos con el
 * mismo horario se agrupan en un tramo para que la línea quepa en el prompt.
 */
export function formatScheduleHuman(schedule: Record<string, string>): string {
  const normalizado: Record<string, string> = {};
  for (const [k, v] of Object.entries(schedule ?? {})) normalizado[k.trim().toLowerCase()] = v;

  const tramos: Array<{ desde: string; hasta: string; horario: string }> = [];
  for (const dia of DIAS_HUMANOS) {
    const horario = (normalizado[dia.clave] ?? normalizado[dia.larga] ?? "").trim();
    if (!horario) continue;
    const ultimo = tramos[tramos.length - 1];
    // Solo se fusiona con el tramo anterior si es el día INMEDIATAMENTE siguiente: si el
    // miércoles cierra, "L-M" y "J-V" son dos tramos, no "L-V".
    const contiguo = ultimo && ultimo.horario === horario && ultimo.hasta === diaPrevio(dia.etiqueta);
    if (contiguo) ultimo.hasta = dia.etiqueta;
    else tramos.push({ desde: dia.etiqueta, hasta: dia.etiqueta, horario });
  }
  return tramos
    .map((t) => `${t.desde === t.hasta ? t.desde : `${t.desde}-${t.hasta}`} ${t.horario.replace(/\|/g, " y ")}`)
    .join(", ");
}

/** Etiqueta del día anterior en el orden humano; null para el lunes. */
function diaPrevio(etiqueta: string): string | null {
  const i = DIAS_HUMANOS.findIndex((d) => d.etiqueta === etiqueta);
  return i > 0 ? DIAS_HUMANOS[i - 1]!.etiqueta : null;
}

/**
 * Genera slots disponibles para un servicio en un rango de fechas.
 * @param startDate - inicio (inclusive)
 * @param endDate - fin (inclusive)
 * @param duration - duración del slot en minutos
 * @param schedule - horarios del agente { mon: "09:00-18:00", ... }
 * @param timezone - zona horaria (ej "Europe/Madrid")
 * @param blocked - fechas bloqueadas [{ startDate, endDate }, ...]
 * @param stepMin - separación entre inicios consecutivos, en minutos (rejilla de llegadas)
 * @returns slots: [{ startTime: ISO, endTime: ISO }, ...]
 */
export function generateSlots(
  startDate: Date,
  endDate: Date,
  duration: number,
  schedule: Record<string, string>,
  timezone: string,
  blocked: Array<{ startDate: Date; endDate: Date }>,
  stepMin = 30,
  // Instante presente. Inyectable para fijarlo en los tests; por defecto, el reloj real.
  now: Date = new Date()
): Array<{ startTime: string; endTime: string }> {
  // La rejilla y la duración son cosas distintas: un restaurante ocupa la mesa 105 min pero
  // acepta llegadas cada 15. Con el paso a 0 o negativo el bucle no avanzaría nunca.
  const step = Number.isFinite(stepMin) && stepMin > 0 ? Math.floor(stepMin) : 30;
  const slots: Array<{ startTime: string; endTime: string }> = [];
  const tz = DateTime.fromJSDate(startDate, { zone: timezone });
  const end = DateTime.fromJSDate(endDate, { zone: timezone });
  // Suelo real: ningun hueco del pasado, pida lo que pida quien llama. El filtro de mas
  // abajo solo compara contra el inicio del rango PEDIDO, asi que una consulta a un rango
  // ya pasado (el modelo llego a pedir agosto de 2023) devolvia huecos que nadie puede
  // reservar. `GET /slots` y `POST /reserve` pasan por aqui tambien.
  const floor = DateTime.fromJSDate(now, { zone: timezone });
  const minStart = floor > tz ? floor : tz;

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
            if (slotStart >= minStart) {
              slots.push({
                startTime: slotStart.toISO()!,
                endTime: slotEnd.toISO()!,
              });
            }

            minute += step; // rejilla de llegadas, `Service.slotStepMin`
          }
        }
      }
    }
    current = current.plus({ days: 1 });
  }

  return slots;
}
