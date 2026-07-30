import { DateTime } from "luxon";

import { prisma } from "@/lib/db";

/**
 * Subconjunto de lectura que necesita este modulo. Estructural a proposito, igual que en
 * `appointments.ts`: acepta el cliente global y tambien el `tx` de una transaccion.
 */
type ScheduleReadClient = {
  agentSchedule: { findUnique: (typeof prisma)["agentSchedule"]["findUnique"] };
};

/**
 * Zona del negocio cuando el agente no tiene horario configurado. Es la misma que usa por
 * defecto la columna `aa.horario_agente.zona_horaria`.
 */
export const DEFAULT_TIMEZONE = "Europe/Madrid";

/**
 * Todo instante que sale hacia el cliente —el prompt del modelo, la notificacion al dueno—
 * viaja en la zona del negocio y CON offset ("2026-08-03T21:00:00.000+02:00").
 *
 * `Appointment.startTime` es `timestamp without time zone` y guarda un instante UTC, asi
 * que `toISOString()` devolvia "...T19:00:00.000Z" para una cena de las 21:00. El modelo
 * no tiene forma de saber que eso es UTC y confirmaba "te he agendado a las 19:00", una
 * hora a la que el restaurante ni siquiera ha abierto.
 *
 * El formato no es nuevo: es exactamente el que `generateSlots` ya emite al ofrecer huecos
 * (luxon con `zone: timezone`). Lo que se corrige es que el resto del flujo —confirmacion,
 * listado, cancelacion— hablaba en otro reloj que el de la disponibilidad ofrecida.
 */
export function toZonedIso(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: "utc" }).setZone(timezone).toISO()!;
}

/**
 * Lee un ISO 8601 que viene del modelo, en la zona del negocio.
 *
 * El LLM emite casi siempre la fecha SIN offset ("2026-08-07T20:30:00"), y `new Date()`
 * interpreta eso en la zona del PROCESO. En Render el proceso corre en UTC, asi que las
 * 20:30 que acababa de acordar con el cliente se convertian en las 22:30 de Madrid. Dos
 * consecuencias medidas en produccion:
 *   - `consultar_disponibilidad` para la noche del 7 devolvia los huecos del 8, porque el
 *     `hasta` de las 22:45 caia ya en la madrugada siguiente.
 *   - `crear_reserva` buscaba un hueco que no existe y devolvia SIEMPRE "el slot ya no
 *     esta disponible", que el modelo le traslada al cliente como "estamos completos".
 *
 * Un ISO que SI trae offset (o `Z`) se respeta tal cual: ya es un instante sin ambiguedad
 * y reinterpretarlo lo moveria. Es el caso de los slots que devuelve `generateSlots`.
 *
 * Devuelve el `DateTime` de luxon —invalido si la cadena no se puede leer— para que quien
 * llama decida el error que emite hacia el bucle agentico.
 */
export function parseIsoInZone(value: string, timezone: string): DateTime {
  return DateTime.fromISO(value, { zone: timezone, setZone: true });
}

/** Zona horaria configurada del agente; `DEFAULT_TIMEZONE` si aun no tiene horario. */
export async function getAgentTimezone(
  agentId: string,
  client: ScheduleReadClient = prisma
): Promise<string> {
  const schedule = await client.agentSchedule.findUnique({
    where: { agentId },
    select: { timezone: true },
  });
  return schedule?.timezone || DEFAULT_TIMEZONE;
}
