import { Router } from "express";
import { prisma } from "@/lib/db";
import { getValidPlatformToken } from "@/lib/integrations/oauth";
import { createEvent, updateEvent, deleteEvent } from "@/lib/integrations/calendar";
import { asyncHandler, HttpError } from "@/lib/http";
import { logger } from "@/lib/logger";

/**
 * Citas manuales del owner en /agenda (aa-agenda-google-import).
 *
 * Independiente de Agent/Service/Appointment (esas son reservas de clientes
 * vía widget de booking). Persiste SIEMPRE en PlatformAppointment — si el
 * Calendar de plataforma está conectado, además se replica en Google
 * (gcalEventId), pero la persistencia en BD no depende de esa sincronización.
 */
export const agendaAppointmentsRouter = Router();

function toDateTimeSlices(appt: { startAt: Date }) {
  const d = appt.startAt;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/**
 * Resumen de contacto para el detalle de la cita (T9, mismo patrón que
 * GET /api/booking/appointments en booking.ts): se cruza email/phone contra
 * Tenant y, si no hay match, contra ProspectContact; sin match, fallback con
 * el nombre libre de la cita.
 */
async function buildContactSummary(a: { client: string; email: string | null; phone: string | null }) {
  const email = a.email || null;
  const phone = a.phone || null;
  let contactSummary: any = null;

  // 1. Buscar en Tenant (Cliente general)
  if (email || phone) {
    const tenant = await prisma.tenant.findFirst({
      where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
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
      where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
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
  // 3. Fallback: sin match en BD, se usa el nombre libre de la cita
  if (!contactSummary) {
    contactSummary = {
      commercialName: a.client,
      contactPerson: undefined,
      phone: phone || undefined,
      address: undefined,
    };
  }
  return contactSummary;
}

agendaAppointmentsRouter.get(
  "/team",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ orderBy: { role: "asc" } });
    res.json(
      users.map((u) => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        role: u.role,
      }))
    );
  })
);

agendaAppointmentsRouter.get(
  "/appointments",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.platformAppointment.findMany({ orderBy: { startAt: "asc" } });
    res.json(
      await Promise.all(
        rows.map(async (a) => ({
          id: a.id,
          ...toDateTimeSlices(a),
          client: a.client,
          service: a.service ?? "",
          owner: "3A Estudio",
          status: a.status,
          notes: a.notes ?? undefined,
          email: a.email ?? undefined,
          phone: a.phone ?? undefined,
          contactSummary: await buildContactSummary(a),
          gcalEventId: a.gcalEventId ?? undefined,
        }))
      )
    );
  })
);

agendaAppointmentsRouter.post(
  "/appointments",
  asyncHandler(async (req, res) => {
    const { date, time, client, service, notes, email, phone } = req.body as {
      date?: string;
      time?: string;
      client?: string;
      service?: string;
      notes?: string;
      email?: string;
      phone?: string;
    };
    if (!date || !time || !client) throw new HttpError(400, "date, time y client requeridos");

    const startAt = new Date(`${date}T${time}`);
    if (isNaN(startAt.getTime())) throw new HttpError(400, "date/time inválidos");
    const endAt = new Date(startAt.getTime() + 30 * 60_000);

    let gcalEventId: string | undefined;
    const integration = await prisma.platformIntegration.findUnique({ where: { provider: "google" } });
    if (integration) {
      try {
        const token = await getValidPlatformToken("google");
        const created = await createEvent(token, {
          title: service ? `${client} - ${service}` : client,
          startIso: startAt.toISOString(),
          endIso: endAt.toISOString(),
          description: notes,
        });
        gcalEventId = created.id;
      } catch (e) {
        logger.error({ err: e }, "[agenda] no se pudo replicar la cita en Google Calendar:");
      }
    }

    const created = await prisma.platformAppointment.create({
      data: { startAt, endAt, client, service, notes, email, phone, gcalEventId },
    });

    res.status(201).json({
      id: created.id,
      ...toDateTimeSlices(created),
      client: created.client,
      service: created.service ?? "",
      owner: "3A Estudio",
      status: created.status,
      notes: created.notes ?? undefined,
      email: created.email ?? undefined,
      phone: created.phone ?? undefined,
      gcalEventId: created.gcalEventId ?? undefined,
    });
  })
);

const VALID_STATUSES = ["Confirmada", "Pendiente", "Completada", "Cancelada"] as const;

agendaAppointmentsRouter.patch(
  "/appointments/:id",
  asyncHandler(async (req, res) => {
    const { date, time, client, service, notes, status, email, phone } = req.body as {
      date?: string;
      time?: string;
      client?: string;
      service?: string;
      notes?: string;
      status?: string;
      email?: string;
      phone?: string;
    };

    if (status !== undefined && !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      throw new HttpError(400, `status inválido; valores permitidos: ${VALID_STATUSES.join(", ")}`);
    }

    const existing = await prisma.platformAppointment.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Cita no encontrada");

    const data: {
      startAt?: Date;
      endAt?: Date;
      client?: string;
      service?: string;
      notes?: string;
      status?: string;
      email?: string;
      phone?: string;
    } = {};

    // Si cambia date u hora, recalcula startAt/endAt combinando con lo existente
    if (date !== undefined || time !== undefined) {
      const existingSlices = toDateTimeSlices(existing);
      const startAt = new Date(`${date ?? existingSlices.date}T${time ?? existingSlices.time}`);
      if (isNaN(startAt.getTime())) throw new HttpError(400, "date/time inválidos");
      const durationMs = existing.endAt.getTime() - existing.startAt.getTime();
      data.startAt = startAt;
      data.endAt = new Date(startAt.getTime() + durationMs);
    }
    if (client !== undefined) data.client = client;
    if (service !== undefined) data.service = service;
    if (notes !== undefined) data.notes = notes;
    if (status !== undefined) data.status = status;
    if (email !== undefined) data.email = email;
    if (phone !== undefined) data.phone = phone;

    const updated = await prisma.platformAppointment.update({
      where: { id: existing.id },
      data,
    });

    // Sync a Google best-effort: solo si la cita ya está vinculada y la
    // integración de plataforma sigue conectada. Un fallo aquí no rompe la
    // respuesta (la BD ya quedó actualizada).
    if (updated.gcalEventId) {
      const integration = await prisma.platformIntegration.findUnique({ where: { provider: "google" } });
      if (integration) {
        try {
          const token = await getValidPlatformToken("google");
          await updateEvent(token, updated.gcalEventId, {
            title: updated.service ? `${updated.client} - ${updated.service}` : updated.client,
            startIso: updated.startAt.toISOString(),
            endIso: updated.endAt.toISOString(),
            description: updated.notes ?? undefined,
          });
        } catch (e) {
          logger.error({ err: e }, "[agenda] no se pudo actualizar la cita en Google Calendar:");
        }
      }
    }

    res.json({
      id: updated.id,
      ...toDateTimeSlices(updated),
      client: updated.client,
      service: updated.service ?? "",
      owner: "3A Estudio",
      status: updated.status,
      notes: updated.notes ?? undefined,
      email: updated.email ?? undefined,
      phone: updated.phone ?? undefined,
      gcalEventId: updated.gcalEventId ?? undefined,
    });
  })
);

agendaAppointmentsRouter.delete(
  "/appointments/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.platformAppointment.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Cita no encontrada");

    // Borrado en Google best-effort: la BD es la fuente de verdad. Si Google
    // falla, se loguea y el hard-delete en BD continúa igualmente.
    if (existing.gcalEventId) {
      const integration = await prisma.platformIntegration.findUnique({ where: { provider: "google" } });
      if (integration) {
        try {
          const token = await getValidPlatformToken("google");
          await deleteEvent(token, existing.gcalEventId);
        } catch (e) {
          logger.error({ err: e }, "[agenda] no se pudo borrar la cita en Google Calendar:");
        }
      }
    }

    await prisma.platformAppointment.delete({ where: { id: existing.id } });
    res.status(204).end();
  })
);
