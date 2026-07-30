import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getCalendarProvider } from "@/lib/integrations/calendar-provider";
import type { Integration } from "@/lib/generated/prisma/client";

/**
 * Sincroniza una cita (TimeSlot + Appointment) al calendario externo conectado.
 * Retorna externalEventId o null si falla.
 */
export async function syncAppointmentToGcal(
  integration: Integration,
  appointmentId: string,
  slot: { startTime: Date; endTime: Date },
  service: { name: string },
  leadEmail?: string,
  leadPhone?: string
): Promise<string | null> {
  try {
    const metadata = (integration.metadata as any) || {};
    const token = metadata.accessToken;
    if (!token && integration.provider !== "mock") return null;

    const provider = getCalendarProvider(integration.provider, token || "mock-token");

    const result = await provider.createEvent({
      title: `${service.name} — ${leadEmail || leadPhone || "Sin datos"}`,
      startIso: slot.startTime.toISOString(),
      endIso: slot.endTime.toISOString(),
      description: `Cita automática — ID: ${appointmentId}`,
      attendees: leadEmail ? [leadEmail] : undefined,
    });

    if (result.externalId) {
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { gcalEventId: result.externalId },
      });

      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: { slotId: true },
      });
      // `slotId` es nullable desde que cancelar borra la franja: si la cita se cancelo entre
      // la creacion y este punto, no hay franja que marcar y no es un error.
      if (appointment?.slotId) {
        await prisma.timeSlot.update({
          where: { id: appointment.slotId },
          data: { syncedToGcal: result.externalId },
        });
      }
    }

    return result.externalId || null;
  } catch (err) {
    logger.error({ err }, `[sync] Failed to sync appointment ${appointmentId} to ${integration.provider}:`);
    return null;
  }
}

/**
 * Desincroniza una cita del calendario externo conectado.
 */
export async function unsyncAppointmentFromGcal(
  integration: Integration,
  gcalEventId: string
): Promise<boolean> {
  try {
    const metadata = (integration.metadata as any) || {};
    const token = metadata.accessToken;
    if (!token && integration.provider !== "mock") return false;

    const provider = getCalendarProvider(integration.provider, token || "mock-token");
    await provider.deleteEvent(gcalEventId);
    return true;
  } catch (err) {
    logger.error({ err }, `[sync] Failed to delete event ${gcalEventId} from ${integration.provider}:`);
    return false;
  }
}

/**
 * Actualiza una cita existente en el calendario externo conectado.
 */
export async function updateAppointmentInExternalCalendar(
  integration: Integration,
  appointmentId: string,
  gcalEventId: string,
  slot: { startTime: Date; endTime: Date },
  service: { name: string },
  leadEmail?: string,
  leadPhone?: string
): Promise<boolean> {
  try {
    const metadata = (integration.metadata as any) || {};
    const token = metadata.accessToken;
    if (!token && integration.provider !== "mock") return false;

    const provider = getCalendarProvider(integration.provider, token || "mock-token");
    await provider.updateEvent(gcalEventId, {
      title: `${service.name} — ${leadEmail || leadPhone || "Sin datos"}`,
      startIso: slot.startTime.toISOString(),
      endIso: slot.endTime.toISOString(),
      description: `Cita automática — ID: ${appointmentId}`,
      attendees: leadEmail ? [leadEmail] : undefined,
    });
    return true;
  } catch (err) {
    logger.error({ err }, `[sync] Failed to update appointment ${appointmentId} in ${integration.provider}:`);
    return false;
  }
}
