import { Router } from "express";
import { z } from "zod";
import { base64ImageSchema } from "@/lib/schemas";
import { asyncHandler, validate } from "@/lib/http";
import {
  listAgents,
  createAgent,
  getAgentDetail,
  updateAgent,
  deleteAgent,
  updateWidgetConfig,
  updateEcommerceConfig,
  listAgentLeads,
} from "@/lib/agent/service";

/* ---------- Agentes ---------- */

export const agentsRouter = Router();

/** Acepta "miweb.com" y lo normaliza a "https://miweb.com"; vacío → undefined. */
const websiteSchema = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}, z.string().url({ message: "URL de web no válida" }).optional());

const createAgentSchema = z.object({
  name: z.string().min(1),
  sector: z.string().min(1),
  systemPrompt: z.string().min(1),
  model: z.string().default("gpt-4.1-nano"),
  // F2 (aa-openclaw-brain): control-plane switch — "openclaw" enruta al gateway local
  // (ver lib/openai.ts getClientForAgent) y provisiona el agente en OpenClaw (F2-T1).
  runtime: z.enum(["openai", "openclaw"]).default("openai"),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh"]).default("low"),
  temperature: z.number().min(0).max(1).default(0.7),
  channel: z.string().default("widget"),
  clientName: z.string().optional(),
  website: websiteSchema,
  skillIds: z.array(z.string()).default([]),
  widgetPrimaryColor: z.string().optional(),
  widgetSecondaryColor: z.string().optional(),
  widgetAvatarBase64: base64ImageSchema.optional(),
  widgetAvatarEmoji: z.string().optional(),
  widgetTemplateConfig: z.record(z.unknown()).optional(),
});

agentsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await listAgents());
  })
);

agentsRouter.post(
  "/",
  validate.body(createAgentSchema),
  asyncHandler(async (req, res) => {
    const agent = await createAgent(req.validatedBody as z.infer<typeof createAgentSchema>);
    res.status(201).json(agent);
  })
);

agentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await getAgentDetail(req.params.id));
  })
);

const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  temperature: z.number().min(0).max(1).optional(),
  model: z.string().min(1).optional(),
  runtime: z.enum(["openai", "openclaw"]).optional(), // F2 (aa-openclaw-brain)
  reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh"]).optional(),
  channel: z.string().min(1).optional(),
});

agentsRouter.patch(
  "/:id",
  validate.body(updateAgentSchema),
  asyncHandler(async (req, res) => {
    const data = req.validatedBody as z.infer<typeof updateAgentSchema>;
    res.json(await updateAgent(req.params.id, data));
  })
);

agentsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await deleteAgent(req.params.id);
    res.json({ ok: true });
  })
);

const widgetConfigSchema = z.object({
  widgetPrimaryColor: z.string().optional(),
  widgetSecondaryColor: z.string().optional(),
  widgetAvatarBase64: base64ImageSchema.nullable().optional(),
  widgetAvatarEmoji: z.string().optional(),
  widgetTemplateConfig: z.record(z.unknown()).optional(),
});

agentsRouter.patch(
  "/:id/widget-config",
  validate.body(widgetConfigSchema),
  asyncHandler(async (req, res) => {
    const data = req.validatedBody as z.infer<typeof widgetConfigSchema>;
    res.json(await updateWidgetConfig(req.params.id, data));
  })
);

/* ---------- Ecommerce config ---------- */

const ecommerceConfigSchema = z.object({
  businessHours: z
    .object({
      timezone: z.string(),
      schedule: z.array(
        z.object({
          day: z.number().int().min(0).max(6),
          open: z.string(),
          close: z.string(),
        })
      ),
    })
    .optional(),
  handoffSlackChannel: z.string().optional(),
  orderStatusUrl: z.string().url().optional().or(z.literal("")),
  orderStatusApiKey: z.string().optional(), // texto plano → se cifra aquí
});

agentsRouter.patch(
  "/:id/ecommerce-config",
  validate.body(ecommerceConfigSchema),
  asyncHandler(async (req, res) => {
    const incoming = req.validatedBody as z.infer<typeof ecommerceConfigSchema>;
    res.json(await updateEcommerceConfig(req.params.id, incoming));
  })
);

/* ---------- Leads por agente ---------- */

agentsRouter.get(
  "/:id/leads",
  asyncHandler(async (req, res) => {
    res.json({ leads: await listAgentLeads(req.params.id) });
  })
);
