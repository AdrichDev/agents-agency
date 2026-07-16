import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { runAutomations, runAutomation } from "@/lib/automations/engine";
import { importWorkflowForAgent } from "@/lib/automations/import";
import * as n8n from "@/lib/n8n/client";
import { buildWorkflow } from "@/lib/n8n/workflow-builder";
import { asyncHandler, validate, HttpError } from "@/lib/http";
import { logger } from "@/lib/logger";

/* ---------- Automatizaciones ---------- */

export const automationsRouter = Router();

const automationSchema = z.object({
  agentId: z.string(),
  name: z.string().min(1),
  trigger: z.enum(["new_email", "new_slack_message", "schedule"]),
  prompt: z.string().min(1),
  config: z
    .object({
      service: z.string().optional(),
      action: z.string().optional(),
      intervalMinutes: z.number().int().positive().optional(),
    })
    .optional()
    .default({}),
});

automationsRouter.post(
  "/",
  validate.body(automationSchema),
  asyncHandler(async (req, res) => {
    const data = req.validatedBody as z.infer<typeof automationSchema>;

    // Persistir la fila primero
    const automation = await prisma.automation.create({ data });

    // Sincronizar con n8n best-effort (R4-1, AD6)
    let workflowId: string | null = null;
    let syncStatus: string = "pending";
    try {
      const wf = buildWorkflow({ ...automation, config: automation.config as { intervalMinutes?: number } | null });
      const r = await n8n.createWorkflow(wf);
      workflowId = r.workflowId;
      syncStatus = r.status;
      // Activar si enabled y n8n lo creó correctamente
      if (r.status === "synced" && r.workflowId && automation.enabled) {
        await n8n.activateWorkflow(r.workflowId);
      }
    } catch (e) {
      logger.error({ err: e }, "[automations] build/sync error:");
      syncStatus = "error";
    }

    // NOTA (riesgo #6 design): para triggers de evento (new_email/new_slack_message)
    // no marcamos syncStatus="synced" en esta fase — el cron los sigue ejecutando
    // hasta que exista el push externo (Gmail watch / Slack Events).
    if (automation.trigger !== "schedule" && syncStatus === "synced") {
      syncStatus = "pending";
      workflowId = null;
    }

    await prisma.automation.update({
      where: { id: automation.id },
      data: { n8nWorkflowId: workflowId, syncStatus },
    });

    res.status(201).json({ ...automation, n8nWorkflowId: workflowId, syncStatus });
  })
);

/* --- POST /api/automations/import (F5 T5.4, AC8) --- */

const importSchema = z
  .object({
    agentId: z.string().min(1),
    name: z.string().min(1).max(120).optional(),
    workflowJson: z.record(z.unknown()).optional(),
    n8nWorkflowId: z.string().min(1).max(64).optional(),
  })
  .refine((v) => Boolean(v.workflowJson) !== Boolean(v.n8nWorkflowId), {
    message: "Indica workflowJson O n8nWorkflowId (exactamente uno)",
  });

automationsRouter.post(
  "/import",
  validate.body(importSchema),
  asyncHandler(async (req, res) => {
    const data = req.validatedBody as z.infer<typeof importSchema>;
    const automation = await importWorkflowForAgent(data);
    res.status(201).json(automation);
  })
);

/* --- GET /api/automations/:id/executions (historial embebido, absorbe Logs) --- */

automationsRouter.get(
  "/:id/executions",
  asyncHandler(async (req, res) => {
    const automation = await prisma.automation.findUnique({
      where: { id: req.params.id },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 20 } },
    });
    if (!automation) throw new HttpError(404, "Automation not found");

    // Workflows importados/sincronizados: el historial vive en n8n. El scoping
    // por agente está garantizado porque solo se consulta el workflowId
    // vinculado a ESTA automatización.
    if (automation.n8nWorkflowId) {
      const executions = await n8n.listWorkflowExecutions(automation.n8nWorkflowId);
      if (executions !== null) {
        return res.json({ source: "n8n", executions });
      }
    }
    res.json({ source: "internal", executions: automation.runs });
  })
);

automationsRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const { id, enabled } = req.body;
    const updated = await prisma.automation.update({ where: { id }, data: { enabled } });

    // Sincronizar estado en n8n best-effort (R4-2)
    let syncStatus: string = updated.syncStatus;
    if (updated.n8nWorkflowId) {
      const r = enabled
        ? await n8n.activateWorkflow(updated.n8nWorkflowId)
        : await n8n.deactivateWorkflow(updated.n8nWorkflowId);
      if (r.notFound) {
        // R4-4: workflow borrado en n8n
        await prisma.automation.update({
          where: { id },
          data: { n8nWorkflowId: null, syncStatus: "error" },
        });
        syncStatus = "error";
      } else {
        syncStatus = r.status;
        await prisma.automation.update({ where: { id }, data: { syncStatus } });
      }
    }

    res.json({ ...updated, syncStatus });
  })
);

automationsRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    const { id } = req.body;
    const automation = await prisma.automation.findUnique({ where: { id } });

    // Intentar borrar en n8n best-effort (R4-3)
    if (automation?.n8nWorkflowId) {
      await n8n.deleteWorkflow(automation.n8nWorkflowId);
      // 404 o error → se loguea dentro del cliente y continuamos
    }

    await prisma.automation.delete({ where: { id } });
    res.json({ ok: true });
  })
);

/* --- POST /api/automations/:id/execute  (llamado por n8n, R3) --- */
automationsRouter.post(
  "/:id/execute",
  asyncHandler(async (req, res) => {
    const secret = process.env.AUTOMATION_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(500).json({ error: "AUTOMATION_WEBHOOK_SECRET not configured" });
    }
    const provided = req.headers["x-automation-secret"];
    if (!provided || provided !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const automation = await prisma.automation.findUnique({ where: { id } });
    if (!automation) throw new HttpError(404, "Automation not found");

    // Nunca 5xx al llamador n8n para evitar reintentos en bucle (R3-4)
    try {
      const result = await runAutomation(id);
      res.json(result);
    } catch (e) {
      res.json({ status: "error", summary: e instanceof Error ? e.message : String(e) });
    }
  })
);

/* --- POST /api/automations/:id/resync  (llamado por la UI, R6-5, AD8) --- */
automationsRouter.post(
  "/:id/resync",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const automation = await prisma.automation.findUnique({ where: { id } });
    if (!automation) throw new HttpError(404, "Automation not found");

    let workflowId: string | null = automation.n8nWorkflowId ?? null;
    let syncStatus: string = "pending";

    try {
    const wf = buildWorkflow({ ...automation, config: automation.config as { intervalMinutes?: number } | null });

    if (workflowId) {
      // Intentar actualizar; si 404, recrear
      const r = await n8n.updateWorkflow(workflowId, wf);
      if (r.notFound) {
        const r2 = await n8n.createWorkflow(wf);
        workflowId = r2.workflowId;
        syncStatus = r2.status;
      } else {
        workflowId = r.workflowId ?? workflowId;
        syncStatus = r.status;
      }
    } else {
      const r = await n8n.createWorkflow(wf);
      workflowId = r.workflowId;
      syncStatus = r.status;
    }

    // Activar/desactivar según estado
    if (syncStatus === "synced" && workflowId) {
      const activateResult = automation.enabled
        ? await n8n.activateWorkflow(workflowId)
        : await n8n.deactivateWorkflow(workflowId);
      if (!activateResult.ok) syncStatus = "error";
    }

    // NOTA riesgo #6: no synced para triggers de evento en esta fase
    if (automation.trigger !== "schedule" && syncStatus === "synced") {
      syncStatus = "pending";
      workflowId = null;
    }
  } catch (e) {
    logger.error({ err: e }, "[automations] resync error:");
    syncStatus = "error";
    workflowId = null;
  }

    await prisma.automation.update({
      where: { id },
      data: { n8nWorkflowId: workflowId, syncStatus },
    });

    res.json({ syncStatus, n8nWorkflowId: workflowId });
  })
);

/* ---------- Cron de automatizaciones (cada 5 min) ---------- */

export const cronRouter = Router();

cronRouter.get(
  "/automations",
  asyncHandler(async (req, res) => {
    // Fail-closed: sin CRON_SECRET configurado, se rechaza (no se omite el check).
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return res.status(503).json({ error: "CRON_SECRET no configurado" });
    }
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "No autorizado" });
    }
    const results = await runAutomations();
    res.json({ ran: results.length, results });
  })
);
