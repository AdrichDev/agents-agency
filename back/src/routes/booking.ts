import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { asyncHandler, validate, HttpError } from "@/lib/http";
import { generateSlots } from "@/lib/booking/slots";
import { syncAppointmentToGcal, unsyncAppointmentFromGcal } from "@/lib/booking/sync";
import { logger } from "@/lib/logger";

export const bookingRouter = Router();

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

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { agent: { include: { schedule: true } } },
    });
    if (!service) throw new HttpError(404, "Servicio no encontrado");

    const schedule = service.agent.schedule;
    if (!schedule) throw new HttpError(400, "Agente sin horario configurado");

    const scheduleJson = (schedule.schedule as any) || {};

    // Obtener rangos bloqueados
    const blocked = await prisma.blockedRange.findMany({
      where: { scheduleId: schedule.id },
    });

    // Generar slots teóricos
    const theoretical = generateSlots(
      new Date(startDate),
      new Date(endDate),
      service.duration,
      scheduleJson,
      schedule.timezone,
      blocked
    );

    // Filtrar: solo slots sin appointment (available = true)
    const existingSlots = await prisma.timeSlot.findMany({
      where: { serviceId, available: false },
      select: { startTime: true },
    });
    const booked = new Set(existingSlots.map((s: { startTime: Date }) => s.startTime.toISOString()));

    const available = theoretical.filter((s) => !booked.has(s.startTime));

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

    // Transacción: verificar y reservar slot, crear appointment
    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Crear TimeSlot
        const slot = await tx.timeSlot.create({
          data: {
            serviceId,
            startTime: new Date(slotStartTime),
            endTime: new Date(slotEndTime),
            available: false,
          },
        });

        // 2. Crear Appointment
        const appointment = await tx.appointment.create({
          data: {
            slotId: slot.id,
            serviceId,
            email: leadEmail,
            phone: leadPhone,
            notes,
          },
          include: { service: true },
        });

        return { slot, appointment };
      },
      { isolationLevel: "Serializable" } // máxima concurrencia
    );

    // 3. Sincronizar a GCal (post-transacción, retry async)
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { agent: true },
    });

    if (service) {
      const gcalIntegration = await prisma.integration.findFirst({
        where: { agentId: service.agentId, provider: "google" },
      });

      if (gcalIntegration) {
        syncAppointmentToGcal(gcalIntegration, result.appointment.id, result.slot, service)
          .catch((err) => logger.error({ err }, "[booking] GCal sync failed, will retry:"));
      }
    }

    res.status(201).json({
      appointmentId: result.appointment.id,
      slotId: result.slot.id,
      startTime: result.slot.startTime,
      endTime: result.slot.endTime,
    });
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
    const { reason } = req.validatedBody as z.infer<typeof cancelSchema>;

    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: { slot: true, service: { include: { agent: true } } },
    });

    if (!appointment) throw new HttpError(404, "Cita no encontrada");
    if (appointment.status === "cancelled") throw new HttpError(400, "Cita ya cancelada");

    // Transacción: liberar slot + marcar cita cancelada
    await prisma.$transaction([
      prisma.timeSlot.update({
        where: { id: appointment.slotId },
        data: { available: true, syncedToGcal: null },
      }),
      prisma.appointment.update({
        where: { id },
        data: { status: "cancelled" },
      }),
    ]);

    // Desincronizar GCal (async, best-effort)
    if (appointment.gcalEventId) {
      const gcalIntegration = await prisma.integration.findFirst({
        where: { agentId: appointment.service.agentId, provider: "google" },
      });
      if (gcalIntegration) {
        unsyncAppointmentFromGcal(gcalIntegration, appointment.gcalEventId).catch((err) =>
          logger.error({ err }, "[booking] GCal delete failed:")
        );
      }
    }

    res.json({ ok: true, status: "cancelled" });
  })
);
