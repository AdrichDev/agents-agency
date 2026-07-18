/**
 * Helpers de reservas REUSABLES (aa-managed-db-conexion-compartida F1) — extraen
 * la logica de booking que antes vivia INLINE en `routes/booking.ts`, para que
 * el endpoint HTTP y el adapter `managed_db` (`agent-backend/managed-db.ts`)
 * compartan exactamente el mismo camino y no divergan.
 *
 * Todo opera sobre los MODELOS Prisma reales del schema `aa`
 * (`Service`/`servicio_agente`, `TimeSlot`/`franja_horaria`, `Appointment`/`cita`,
 * `AgentSchedule`, `BlockedRange`, `Lead`). El aislamiento por agente se preserva:
 * las reservas cuelgan de un `serviceId` cuyo `service.agentId` acota al agente;
 * la disponibilidad y la cancelacion parten del servicio/cita.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { generateSlots } from "@/lib/booking/slots";
import { syncAppointmentToGcal, unsyncAppointmentFromGcal } from "@/lib/booking/sync";

// ── Errores de dominio ──────────────────────────────────────────────────────
// El endpoint HTTP los mapea a HttpError (status); el adapter managed_db los deja
// propagar como error CLARO (no un 500 opaco).

export class ServiceNotFoundError extends Error {
  constructor(public readonly serviceRef: string) {
    super("Servicio no encontrado");
    this.name = "ServiceNotFoundError";
  }
}

export class ScheduleNotConfiguredError extends Error {
  constructor() {
    super("Agente sin horario configurado");
    this.name = "ScheduleNotConfiguredError";
  }
}

export class SlotUnavailableError extends Error {
  constructor(public readonly startTime: string) {
    super("El slot ya no esta disponible");
    this.name = "SlotUnavailableError";
  }
}

export class AppointmentNotFoundError extends Error {
  constructor(public readonly appointmentId: string) {
    super("Cita no encontrada");
    this.name = "AppointmentNotFoundError";
  }
}

export class AppointmentAlreadyCancelledError extends Error {
  constructor() {
    super("Cita ya cancelada");
    this.name = "AppointmentAlreadyCancelledError";
  }
}

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface AvailableSlot {
  startTime: string;
  endTime: string;
}

export interface CreateAppointmentInput {
  serviceId: string;
  slotStart: Date;
  slotEnd: Date;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  leadId?: string | null;
}

export interface CreatedAppointment {
  appointmentId: string;
  slotId: string;
  startTime: Date;
  endTime: Date;
  service: { id: string; name: string; agentId: string };
}

// ── Disponibilidad ──────────────────────────────────────────────────────────

/**
 * Replica `routes/booking.ts` GET /slots: carga servicio + horario del agente,
 * genera los slots teoricos con `generateSlots` (puro) y resta las franjas ya
 * reservadas (`franja_horaria` con `disponible=false`). Lanza
 * `ServiceNotFoundError`/`ScheduleNotConfiguredError` si falta el servicio o el
 * horario del agente (para no producir un 500 opaco).
 */
export async function computeAvailableSlots(
  serviceId: string,
  rango: { desde: Date; hasta: Date }
): Promise<AvailableSlot[]> {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: { agent: { include: { schedule: true } } },
  });
  if (!service) throw new ServiceNotFoundError(serviceId);

  const schedule = service.agent.schedule;
  if (!schedule) throw new ScheduleNotConfiguredError();

  const scheduleJson = (schedule.schedule as Record<string, string>) || {};

  const blocked = await prisma.blockedRange.findMany({
    where: { scheduleId: schedule.id },
  });

  const theoretical = generateSlots(
    rango.desde,
    rango.hasta,
    service.duration,
    scheduleJson,
    schedule.timezone,
    blocked
  );

  const existingSlots = await prisma.timeSlot.findMany({
    where: { serviceId, available: false },
    select: { startTime: true },
  });
  const booked = new Set(existingSlots.map((s: { startTime: Date }) => s.startTime.toISOString()));

  return theoretical.filter((s) => !booked.has(s.startTime));
}

// ── Creacion de reserva ─────────────────────────────────────────────────────

/**
 * Replica la transaccion de `routes/booking.ts` POST /reserve: crea la franja
 * (`franja_horaria`, `disponible=false`) y la cita (`cita`) en una transaccion
 * Serializable, y sincroniza el calendario externo post-transaccion (best-effort).
 *
 * El unique `(servicio_id, inicio)` de `franja_horaria` bloquea dobles reservas
 * concurrentes: un choque emerge como `P2002` y se traduce a `SlotUnavailableError`.
 */
export async function createAppointment(input: CreateAppointmentInput): Promise<CreatedAppointment> {
  const { serviceId, slotStart, slotEnd, email, phone, notes, leadId } = input;

  let result: {
    slot: { id: string; startTime: Date; endTime: Date };
    appointment: { id: string; service: { id: string; name: string; agentId: string } };
  };
  try {
    result = await prisma.$transaction(
      async (tx) => {
        const slot = await tx.timeSlot.create({
          data: {
            serviceId,
            startTime: slotStart,
            endTime: slotEnd,
            available: false,
          },
        });

        const appointment = await tx.appointment.create({
          data: {
            slotId: slot.id,
            serviceId,
            leadId: leadId ?? undefined,
            email: email ?? undefined,
            phone: phone ?? undefined,
            notes: notes ?? undefined,
          },
          include: { service: true },
        });

        return { slot, appointment };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err) {
    // Colision del unique (servicio_id, inicio): el slot ya esta reservado.
    if ((err as { code?: string }).code === "P2002") {
      throw new SlotUnavailableError(slotStart.toISOString());
    }
    throw err;
  }

  const service = result.appointment.service;

  // Sincronizar calendario externo (post-transaccion, best-effort — nunca rompe).
  const gcalIntegration = await prisma.integration.findFirst({
    where: { agentId: service.agentId, provider: "google" },
  });
  if (gcalIntegration) {
    syncAppointmentToGcal(gcalIntegration, result.appointment.id, result.slot, service).catch((err) =>
      logger.error({ err }, "[booking] GCal sync failed, will retry:")
    );
  }

  return {
    appointmentId: result.appointment.id,
    slotId: result.slot.id,
    startTime: result.slot.startTime,
    endTime: result.slot.endTime,
    service: { id: service.id, name: service.name, agentId: service.agentId },
  };
}

// ── Cancelacion ─────────────────────────────────────────────────────────────

/**
 * Replica `routes/booking.ts` PATCH /:id/cancel: libera la franja
 * (`disponible=true`, `sincronizado_gcal=null`) y marca la cita `cancelled` en
 * una transaccion, y desincroniza el calendario externo (best-effort). Lanza
 * `AppointmentNotFoundError`/`AppointmentAlreadyCancelledError` con mensaje claro.
 */
export async function cancelAppointment(
  appointmentId: string
): Promise<{ ok: boolean; estado: string }> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { slot: true, service: { include: { agent: true } } },
  });
  if (!appointment) throw new AppointmentNotFoundError(appointmentId);
  if (appointment.status === "cancelled") throw new AppointmentAlreadyCancelledError();

  await prisma.$transaction([
    prisma.timeSlot.update({
      where: { id: appointment.slotId },
      data: { available: true, syncedToGcal: null },
    }),
    prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: "cancelled" },
    }),
  ]);

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

  return { ok: true, estado: "cancelled" };
}
