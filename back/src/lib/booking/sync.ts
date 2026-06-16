import { prisma } from "@/lib/db";
import * as calendar from "@/lib/integrations/calendar";
import type { Integration } from "@prisma/client";

/**
 * Sincroniza una cita (TimeSlot + Appointment) a Google Calendar.
 * Retorna gcalEventId o null si falla.
 *
 * Transacción: primero crear en GCal, luego guardar ID en DB.
 * Si GCal falla, la cita queda sin sincronizar (retry manual).
 */
export async function syncAppointmentToGcal(
  googleIntegration: Integration,
  appointmentId: string,
  slot: { startTime: Date; endTime: Date },
  service: { name: string },
  leadEmail?: string,
  leadPhone?: string
): Promise<string | null> {
  try {
    // Obtener token de integración (asume que está en metadata.accessToken)
    const metadata = (googleIntegration.metadata as any) || {};
    const token = metadata.accessToken;
    if (!token) return null;

    // Crear evento en GCal
    const gcalResult = await calendar.createEvent(token, {
      title: `${service.name} — ${leadEmail || leadPhone || "Sin datos"}`,
      startIso: slot.startTime.toISOString(),
      endIso: slot.endTime.toISOString(),
      description: `Cita automática — ID: ${appointmentId}`,
      attendees: leadEmail ? [leadEmail] : undefined,
    });

    // Guardar ID en DB
    if (gcalResult.id) {
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { gcalEventId: gcalResult.id },
      });

      // Guardar también en TimeSlot
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: { slotId: true },
      });
      if (appointment) {
        await prisma.timeSlot.update({
          where: { id: appointment.slotId },
          data: { syncedToGcal: gcalResult.id },
        });
      }
    }

    return gcalResult.id || null;
  } catch (err) {
    console.error(`[sync] Failed to sync appointment ${appointmentId} to GCal:`, err);
    return null; // retry manual o async job
  }
}

/**
 * Desincroniza una cita de Google Calendar.
 */
export async function unsyncAppointmentFromGcal(
  googleIntegration: Integration,
  gcalEventId: string
): Promise<boolean> {
  try {
    const metadata = (googleIntegration.metadata as any) || {};
    const token = metadata.accessToken;
    if (!token) return false;

    await calendar.deleteEvent(token, gcalEventId);
    return true;
  } catch (err) {
    console.error(`[sync] Failed to delete GCal event ${gcalEventId}:`, err);
    return false;
  }
}
