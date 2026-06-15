import { Router } from "express";
import { getStats, getDrilldown, statsQuerySchema } from "@/lib/stats";
import { asyncHandler, HttpError } from "@/lib/http";

/* ---------- Stats ---------- */

export const statsRouter = Router();

statsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    // Parse optional query params; no params → P7 backward-compatible path
    const hasParams = Object.keys(req.query).length > 0;
    if (!hasParams) {
      return res.json(await getStats());
    }

    const parsed = statsQuerySchema.safeParse({
      granularity: req.query.granularity,
      range: req.query.range,
      from: req.query.from,
      to: req.query.to,
      clientId: req.query.clientId,
      serviceId: req.query.serviceId,
      agentId: req.query.agentId,
      status: req.query.status,
      sector: req.query.sector,
      revenueType: req.query.revenueType,
    });

    if (!parsed.success) {
      throw new HttpError(400, "Datos inválidos", "VALIDATION_ERROR", parsed.error.flatten());
    }

    res.json(await getStats(parsed.data));
  })
);

statsRouter.get(
  "/drilldown",
  asyncHandler(async (req, res) => {
    const period = String(req.query.period ?? "");
    if (!period) throw new HttpError(400, "period requerido");

    const queryParsed = statsQuerySchema.safeParse({
      clientId: req.query.clientId,
      serviceId: req.query.serviceId,
      agentId: req.query.agentId,
      status: req.query.status,
      sector: req.query.sector,
    });

    const result = await getDrilldown(period, queryParsed.success ? queryParsed.data : undefined);
    res.json(result);
  })
);
