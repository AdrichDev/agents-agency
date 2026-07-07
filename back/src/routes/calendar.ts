import { Router } from "express";
import { prisma } from "@/lib/db";
import { getValidPlatformToken, disconnectPlatformIntegration } from "@/lib/integrations/oauth";
import { listEventsRange } from "@/lib/integrations/calendar";
import { asyncHandler, HttpError } from "@/lib/http";
import { logger } from "@/lib/logger";

/**
 * Google Calendar de PLATAFORMA para la agenda (aa-agenda-google-import).
 *
 * AA es single-tenant: hay exactamente una cuenta Google (el owner). Lee
 * `PlatformIntegration`, no `Integration` (esa es por-agente/tenant, para que
 * cada chatbot de cliente consulte/reserve en el calendario de SU negocio).
 */
export const calendarRouter = Router();

/** GET /api/calendar/status — conexión de plataforma */
calendarRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    const integration = await prisma.platformIntegration.findUnique({ where: { provider: "google" } });
    const metadata = (integration?.metadata as Record<string, unknown> | null) ?? {};
    res.json({
      connected: !!integration,
      accountLabel: typeof metadata.email === "string" ? metadata.email : null,
    });
  })
);

/** GET /api/calendar/events?from&to — primary-calendar events in ISO range */
calendarRouter.get(
  "/events",
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) throw new HttpError(400, "from y to (ISO) requeridos");
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new HttpError(400, "from/to inválidos");
    }

    const integration = await prisma.platformIntegration.findUnique({ where: { provider: "google" } });
    if (!integration) throw new HttpError(409, "Google Calendar no conectado");

    try {
      const token = await getValidPlatformToken("google");
      const events = await listEventsRange(token, fromDate.toISOString(), toDate.toISOString());
      res.json({ events });
    } catch (e) {
      logger.error({ err: e }, "[calendar] error listando eventos de Google:");
      throw new HttpError(502, "Error consultando Google Calendar");
    }
  })
);

/** DELETE /api/calendar/status — desconectar el Calendar de plataforma */
calendarRouter.delete(
  "/status",
  asyncHandler(async (_req, res) => {
    await disconnectPlatformIntegration("google");
    res.json({ ok: true });
  })
);
