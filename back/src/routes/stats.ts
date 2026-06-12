import { Router } from "express";
import { getStats, getDrilldown, statsQuerySchema } from "@/lib/stats";

/* ---------- Stats ---------- */

export const statsRouter = Router();

statsRouter.get("/", async (req, res) => {
  // Parse optional query params; no params → P7 backward-compatible path
  const hasParams = Object.keys(req.query).length > 0;
  if (!hasParams) {
    try {
      return res.json(await getStats());
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
    }
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
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    res.json(await getStats(parsed.data));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});

statsRouter.get("/drilldown", async (req, res) => {
  const period = String(req.query.period ?? "");
  if (!period) return res.status(400).json({ error: "period requerido" });

  const queryParsed = statsQuerySchema.safeParse({
    clientId: req.query.clientId,
    serviceId: req.query.serviceId,
    agentId: req.query.agentId,
    status: req.query.status,
    sector: req.query.sector,
  });

  try {
    const result = await getDrilldown(period, queryParsed.success ? queryParsed.data : undefined);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});
