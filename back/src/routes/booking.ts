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
  GroupTooLargeError,
  AppointmentNotFoundError,
  AppointmentAlreadyCancelledError,
} from "@/lib/booking/appointments";
import { logger } from "@/lib/logger";
import { assertAgentServable } from "@/lib/agent/lifecycle";
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
    // 422, no 409: el grupo no cabe por diseño del servicio, no por una colisión temporal.
    // Reintentar la misma petición nunca funcionará.
    if (err instanceof GroupTooLargeError) throw new HttpError(422, err.message);
    if (err instanceof AppointmentNotFoundError) throw new HttpError(404, "Cita no encontrada");
    if (err instanceof AppointmentAlreadyCancelledError)
      throw new HttpError(400, "Cita ya cancelada");
    throw err;
  }
}

/**
 * H3 (aa-agente-ciclo-vida-publicacion, T2.5) — Gate de PUBLICACIÓN para las rutas
 * públicas de reservas. `/slots` y `/reserve` no pasan por `runAgent`, así que no heredan
 * el gate del cuello; y una reserva es un compromiso real (bloquea un hueco de agenda y
 * puede acabar en Google Calendar) sin gastar un token de LLM, de modo que "no consume
 * tokens" no las exime.
 *
 * El agente se resuelve por el servicio, que es lo que reciben estos endpoints. Si el
 * servicio no existe, NO se decide aquí: se deja pasar para que el camino actual devuelva
 * su propio error (mapBookingError), y no cambiar la semántica que ya tenía.
 */
async function assertServiceAgentServable(serviceId: string): Promise<void> {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { agent: { select: { status: true } } },
  });
  if (!service) return;
  assertAgentServable(service.agent.status);
}

// ── GET /api/booking/slots — Slots disponibles para un servicio ───────────

const slotsQuerySchema = z.object({
  serviceId: z.string(),
  startDate: z.string(), // ISO date
  endDate: z.string(),   // ISO date
  // Por defecto 1: los llamadores existentes (formularios de una sola plaza) siguen igual.
  partySize: z.coerce.number().int().positive().optional(),
});

bookingRouter.get(
  "/slots",
  validate.query(slotsQuerySchema),
  asyncHandler(async (req, res) => {
    const { serviceId, startDate, endDate, partySize } = req.validatedQuery as z.infer<
      typeof slotsQuerySchema
    >;

    // T2.5: un agente sin publicar no expone su agenda. Se corta aquí y no sólo en
    // /reserve, porque los slots ya revelan servicios y horarios del negocio.
    await assertServiceAgentServable(serviceId);

    // Delega en el helper compartido (mismo camino que el adapter managed_db).
    const available = await mapBookingError(() =>
      computeAvailableSlots(
        serviceId,
        { desde: new Date(startDate), hasta: new Date(endDate) },
        prisma,
        partySize ?? 1
      )
    );

    // `freeResourceIds` es detalle de inventario: al visitante no le importa qué mesa se le
    // asignará, y publicar los ids permitiría deducir el aforo y la ocupación del negocio.
    res.json({ slots: available.map((s) => ({ startTime: s.startTime, endTime: s.endTime })) });
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
  partySize: z.coerce.number().int().positive().optional(),
  customerName: z.string().optional(),
});

bookingRouter.post(
  "/reserve",
  validate.body(reserveSchema),
  asyncHandler(async (req, res) => {
    const {
      serviceId,
      slotStartTime,
      slotEndTime,
      leadEmail,
      leadPhone,
      notes,
      partySize,
      customerName,
    } = req.validatedBody as z.infer<typeof reserveSchema>;

    // T2.5: un agente sin publicar no acepta citas. Es la vía de servicio más costosa que
    // no toca el LLM: bloquea agenda y puede sincronizar con Google Calendar.
    await assertServiceAgentServable(serviceId);

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
        partySize,
        customerName,
      })
    );

    res.status(201).json({
      appointmentId: result.appointmentId,
      slotId: result.slotId,
      startTime: result.startTime,
      endTime: result.endTime,
      partySize: result.partySize,
      confirmationCode: result.confirmationCode,
      resource: result.resource,
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
      // Se lee de la cita, no de la franja: una cita cancelada ya no tiene franja.
      const start = DateTime.fromJSDate(a.startTime).setZone(tz);
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
      // De la cita, no de la franja: la franja desaparece al cancelar.
      startTime: a.startTime,
      endTime: a.endTime,
      partySize: a.partySize,
      confirmationCode: a.confirmationCode,
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
    // Una cita cancelada ya no tiene franja (se borra al cancelar para liberar el recurso).
    // El caso queda cubierto por el check anterior, pero el tipo es nullable y sin esto se
    // reprogramaria contra `id: null`.
    if (!appointment.slotId) throw new HttpError(400, "Cita sin franja asociada");

    const newStart = new Date(slotStartTime);
    const newEnd = new Date(slotEndTime);
    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime()) || newEnd <= newStart) {
      throw new HttpError(400, "Rango horario inválido");
    }

    // Transacción: mover la franja Y el horario de la cita. Las dos, o la cita quedaría
    // apuntando a una hora distinta de la que ocupa en el inventario.
    await prisma.$transaction([
      prisma.timeSlot.update({
        where: { id: appointment.slotId },
        data: { startTime: newStart, endTime: newEnd },
      }),
      prisma.appointment.update({
        where: { id },
        data: { startTime: newStart, endTime: newEnd, ...(notes !== undefined ? { notes } : {}) },
      }),
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
