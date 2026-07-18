import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { asyncHandler, validate, HttpError } from "@/lib/http";
import { updateAppointmentInExternalCalendar } from "@/lib/booking/sync";
import {
  computeAvailableSlots,
  createAppointment,
  cancelAppointment,
  ServiceNotFoundError,
  ScheduleNotConfiguredError,
  SlotUnavailableError,
  AppointmentNotFoundError,
  AppointmentAlreadyCancelledError,
} from "@/lib/booking/appointments";
import { logger } from "@/lib/logger";
import { DateTime } from "luxon";

export const bookingRouter = Router();

/**
 * Mapea los errores de dominio de `lib/booking/appointments.ts` a `HttpError`
 * con el mismo status/mensaje que exponia antes la logica inline del router
 * (comportamiento preservado). El adapter managed_db, en cambio, los deja
 * propagar tal cual (error claro, no un 500 opaco).
 */
async function mapBookingError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ServiceNotFoundError) throw new HttpError(404, "Servicio no encontrado");
    if (err instanceof ScheduleNotConfiguredError)
      throw new HttpError(400, "Agente sin horario configurado");
    if (err instanceof SlotUnavailableError)
      throw new HttpError(409, "El slot ya no esta disponible");
    if (err instanceof AppointmentNotFoundError) throw new HttpError(404, "Cita no encontrada");
    if (err instanceof AppointmentAlreadyCancelledError)
      throw new HttpError(400, "Cita ya cancelada");
    throw err;
  }
}

// ── GET /api/booking/slots — Slots disponibles para un servicio ───────────

const slotsQuerySchema = z.object({
  serviceId: z.string(),
  startDate: z.string(), // ISO date
  endDate: z.string(),   // ISO date
});

bookingRouter.get(
  "/slots",
  validate.query(slotsQuerySchema),
  asyncHandler(async (req, res) => {
    const { serviceId, startDate, endDate } = req.validatedQuery as z.infer<typeof slotsQuerySchema>;

    // Delega en el helper compartido (mismo camino que el adapter managed_db).
    const available = await mapBookingError(() =>
      computeAvailableSlots(serviceId, { desde: new Date(startDate), hasta: new Date(endDate) })
    );

    res.json({ slots: available });
  })
);

// ── POST /api/booking/reserve — Crear cita con bloqueo transaccional ─────

const reserveSchema = z.object({
  serviceId: z.string(),
  slotStartTime: z.string(), // ISO
  slotEndTime: z.string(),   // ISO
  leadEmail: z.string().email().optional(),
  leadPhone: z.string().optional(),
  notes: z.string().optional(),
});

bookingRouter.post(
  "/reserve",
  validate.body(reserveSchema),
  asyncHandler(async (req, res) => {
    const { serviceId, slotStartTime, slotEndTime, leadEmail, leadPhone, notes } =
      req.validatedBody as z.infer<typeof reserveSchema>;

    // Delega en el helper compartido: transaccion Serializable (TimeSlot + Appointment)
    // + sync GCal post-transaccion best-effort (mismo camino que el adapter managed_db).
    const result = await mapBookingError(() =>
      createAppointment({
        serviceId,
        slotStart: new Date(slotStartTime),
        slotEnd: new Date(slotEndTime),
        email: leadEmail,
        phone: leadPhone,
        notes,
      })
    );

    res.status(201).json({
      appointmentId: result.appointmentId,
      slotId: result.slotId,
      startTime: result.startTime,
      endTime: result.endTime,
    });
  })
);

// ── GET /api/booking/appointments — Listar todas las citas ───────────────

bookingRouter.get(
  "/appointments",
  asyncHandler(async (_req, res) => {
    const appointments = await prisma.appointment.findMany({
      include: {
        slot: true,
        lead: true,
        service: {
          include: {
            agent: {
              include: {
                schedule: true,
              },
            },
          },
        },
      },
      orderBy: { slot: { startTime: "asc" } },
    });

    const items = [];

    for (const a of appointments) {
      const email = a.email || a.lead?.email || null;
      const phone = a.phone || a.lead?.phone || null;

      let contactSummary: any = null;

      // 1. Buscar en Tenant (Cliente general)
      if (email || phone) {
        const tenant = await prisma.tenant.findFirst({
          where: {
            OR: [
              ...(email ? [{ email }] : []),
              ...(phone ? [{ phone }] : []),
            ],
          },
        });

        if (tenant) {
          contactSummary = {
            commercialName: tenant.name,
            contactPerson: tenant.contactPerson || undefined,
            phone: tenant.phone || undefined,
            address: tenant.direccion || undefined,
          };
        }
      }

      // 2. Si no se encuentra en Tenant, buscar en ProspectContact
      if (!contactSummary && (email || phone)) {
        const prospect = await prisma.prospectContact.findFirst({
          where: {
            OR: [
              ...(email ? [{ email }] : []),
              ...(phone ? [{ phone }] : []),
            ],
          },
        });

        if (prospect) {
          contactSummary = {
            commercialName: prospect.name,
            contactPerson: undefined,
            phone: prospect.phone || undefined,
            address: prospect.direccion || undefined,
          };
        }
      }

      // 3. Fallback
      if (!contactSummary) {
        contactSummary = {
          commercialName: a.lead?.customerName || a.email || "Cliente Anónimo",
          contactPerson: undefined,
          phone: phone || undefined,
          address: undefined,
        };
      }

      // Formatear fecha y hora usando la zona horaria del agente
      const tz = a.service.agent.schedule?.timezone || "Europe/Madrid";
      const start = DateTime.fromJSDate(a.slot.startTime).setZone(tz);
      const dateStr = start.toISODate() || "2026-07-05"; // fallback YYYY-MM-DD
      const timeStr = start.toFormat("HH:mm");

      // Map DB status to UI status
      let uiStatus: "Confirmada" | "Pendiente" | "Completada" | "Cancelada" = "Confirmada";
      if (a.status === "cancelled" || a.status === "no-show") {
        uiStatus = "Cancelada";
      } else if (a.status === "attended") {
        uiStatus = "Completada";
      } else if (a.status === "scheduled") {
        uiStatus = "Confirmada";
      } else {
        if (["Confirmada", "Pendiente", "Completada", "Cancelada"].includes(a.status)) {
          uiStatus = a.status as any;
        }
      }

      items.push({
        id: a.id,
        date: dateStr,
        time: timeStr,
        client: a.lead?.customerName || a.email || "Cliente Anónimo",
        service: a.service.name,
        owner: a.service.agent.name,
        status: uiStatus,
        email: email || undefined,
        phone: phone || undefined,
        notes: a.notes || undefined,
        contactSummary,
      });
    }

    res.json(items);
  })
);

// ── GET /api/booking/appointments/:serviceId — Listar citas de un servicio ──

bookingRouter.get(
  "/appointments/:serviceId",
  asyncHandler(async (req, res) => {
    const { serviceId } = req.params;

    const appointments = await prisma.appointment.findMany({
      where: { serviceId },
      include: { slot: true, lead: true },
      orderBy: { createdAt: "desc" },
    });

    const items = appointments.map((a: any) => ({
      id: a.id,
      email: a.email,
      phone: a.phone,
      notes: a.notes,
      status: a.status,
      startTime: a.slot.startTime,
      endTime: a.slot.endTime,
      lead: a.lead?.id ? { id: a.lead.id, name: a.lead.customerName, email: a.lead.email } : null,
    }));

    res.json({ appointments: items });
  })
);

// ── PATCH /api/booking/:id/cancel — Cancelar cita ─────────────────────────

const cancelSchema = z.object({
  reason: z.string().optional(),
});

bookingRouter.patch(
  "/:id/cancel",
  validate.body(cancelSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    // `reason` se valida pero no se persiste (comportamiento previo preservado).

    // Delega en el helper compartido: libera franja + marca cita cancelada +
    // desincroniza GCal best-effort (mismo camino que el adapter managed_db).
    const result = await mapBookingError(() => cancelAppointment(id));

    res.json({ ok: result.ok, status: result.estado });
  })
);

// ── PATCH /api/booking/:id/reschedule — Reprogramar/editar cita ──────────

const rescheduleSchema = z.object({
  slotStartTime: z.string(), // ISO
  slotEndTime: z.string(),   // ISO
  notes: z.string().optional(),
});

bookingRouter.patch(
  "/:id/reschedule",
  validate.body(rescheduleSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { slotStartTime, slotEndTime, notes } =
      req.validatedBody as z.infer<typeof rescheduleSchema>;

    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: { slot: true, service: { include: { agent: true } } },
    });

    if (!appointment) throw new HttpError(404, "Cita no encontrada");
    if (appointment.status === "cancelled")
      throw new HttpError(400, "Cita cancelada, no se puede reprogramar");

    const newStart = new Date(slotStartTime);
    const newEnd = new Date(slotEndTime);
    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime()) || newEnd <= newStart) {
      throw new HttpError(400, "Rango horario inválido");
    }

    // Transacción: mover el slot + actualizar notas si aplica
    await prisma.$transaction([
      prisma.timeSlot.update({
        where: { id: appointment.slotId },
        data: { startTime: newStart, endTime: newEnd },
      }),
      ...(notes !== undefined
        ? [prisma.appointment.update({ where: { id }, data: { notes } })]
        : []),
    ]);

    // Propagar el cambio al calendario externo (async, best-effort)
    if (appointment.gcalEventId) {
      const gcalIntegration = await prisma.integration.findFirst({
        where: { agentId: appointment.service.agentId, provider: "google" },
      });
      if (gcalIntegration) {
        updateAppointmentInExternalCalendar(
          gcalIntegration,
          appointment.id,
          appointment.gcalEventId,
          { startTime: newStart, endTime: newEnd },
          appointment.service,
          appointment.email ?? undefined,
          appointment.phone ?? undefined
        ).catch((err) => logger.error({ err }, "[booking] GCal update failed:"));
      }
    }

    res.json({ ok: true, appointmentId: id, startTime: newStart, endTime: newEnd });
  })
);
