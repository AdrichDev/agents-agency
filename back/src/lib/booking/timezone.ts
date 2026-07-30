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
