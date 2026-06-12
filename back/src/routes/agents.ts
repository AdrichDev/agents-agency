import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { buildSkillStatus } from "@/lib/agent/skill-capabilities";
import { ingestWebsite } from "@/lib/scraper/web";
import * as n8n from "@/lib/n8n/client";
import { encryptToken } from "@/lib/integrations/oauth";
import {
  DEFAULT_WIDGET_PRIMARY,
  DEFAULT_WIDGET_SECONDARY,
  normalizeColorValue,
  normalizeWidgetTemplateConfig,
} from "@/lib/widget-config";
import { base64ImageSchema } from "@/lib/schemas";

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
  model: z.string().default("gpt-5.4-mini"),
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

agentsRouter.get("/", async (_req, res) => {
  const agents = await prisma.agent.findMany({
    include: {
      client: true,
      integrations: { select: { provider: true } },
      _count: { select: { conversations: true, automations: true, knowledge: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  // El listado no necesita ecommerceConfig y contiene la apiKey cifrada — no exponerla
  res.json(agents.map(({ ecommerceConfig, ...agent }) => agent));
});

agentsRouter.post("/", async (req, res) => {
  const parsed = createAgentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { clientName, website, skillIds, ...data } = parsed.data;

  const agent = await prisma.agent.create({
    data: {
      ...data,
      widgetPrimaryColor: data.widgetPrimaryColor
        ? normalizeColorValue(data.widgetPrimaryColor, DEFAULT_WIDGET_PRIMARY)
        : undefined,
      widgetSecondaryColor: data.widgetSecondaryColor
        ? normalizeColorValue(data.widgetSecondaryColor, DEFAULT_WIDGET_SECONDARY)
        : undefined,
      widgetAvatarBase64: data.widgetAvatarBase64 || undefined,
      widgetAvatarEmoji: data.widgetAvatarEmoji || undefined,
      widgetTemplateConfig: data.widgetTemplateConfig
        ? (normalizeWidgetTemplateConfig(data.widgetTemplateConfig) as any)
        : undefined,
      client: clientName
        ? { create: { name: clientName, website, sector: data.sector } }
        : undefined,
      skills: { create: skillIds.map((skillId: string) => ({ skillId })) },
    },
  });

  if (website) ingestWebsite(agent.id, website).catch(() => {});
  res.status(201).json(agent);
});

agentsRouter.get("/:id", async (req, res) => {
  const agent = await prisma.agent.findUnique({
    where: { id: req.params.id },
    include: {
      client: true,
      integrations: { select: { id: true, provider: true, metadata: true, createdAt: true } },
      skills: { include: { skill: true } },
      automations: { include: { runs: { orderBy: { createdAt: "desc" }, take: 20 } } },
      _count: { select: { knowledge: true, conversations: true } },
    },
  });
  if (!agent) return res.status(404).json({ error: "No encontrado" });

  const connectedProviders = (agent.integrations as any[]).map((i) => i.provider);
  const ecomCfg = (agent.ecommerceConfig as any) ?? {};

  // AD4/§5.2: inyectar "ecommerce" como provider ejecutable si orderStatusUrl presente
  const providersForSkillStatus = ecomCfg?.orderStatusUrl
    ? [...connectedProviders, "ecommerce"]
    : connectedProviders;

  const skillStatus = buildSkillStatus(
    (agent.skills as any[])
      .filter((s) => s.skill != null)
      .map((s) => ({ id: s.skillId, name: s.skill.name, use: s.skill.use ?? "" })),
    providersForSkillStatus
  );

  // Enmascarar orderStatusApiKey en la respuesta (R6-1, §6.3)
  const safeEcomCfg = { ...ecomCfg };
  if (safeEcomCfg.orderStatusApiKey) safeEcomCfg.orderStatusApiKey = "***";

  // R6-4: exponer si n8n está configurado para que la UI muestre el aviso
  res.json({ ...agent, ecommerceConfig: safeEcomCfg, skillStatus, n8nConfigured: n8n.isConfigured() });
});

const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  temperature: z.number().min(0).max(1).optional(),
  model: z.string().min(1).optional(),
  channel: z.string().min(1).optional(),
});

agentsRouter.patch("/:id", async (req, res) => {
  const parsed = updateAgentSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const agent = await prisma.agent.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json(agent);
});

agentsRouter.delete("/:id", async (req, res) => {
  await prisma.agent.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

agentsRouter.patch("/:id/widget-config", async (req, res) => {
  const parsed = z
    .object({
      widgetPrimaryColor: z.string().optional(),
      widgetSecondaryColor: z.string().optional(),
      widgetAvatarBase64: base64ImageSchema.nullable().optional(),
      widgetAvatarEmoji: z.string().optional(),
      widgetTemplateConfig: z.record(z.unknown()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const agent = await prisma.agent.update({
    where: { id: req.params.id },
    data: {
      widgetPrimaryColor: parsed.data.widgetPrimaryColor
        ? normalizeColorValue(parsed.data.widgetPrimaryColor, DEFAULT_WIDGET_PRIMARY)
        : undefined,
      widgetSecondaryColor: parsed.data.widgetSecondaryColor
        ? normalizeColorValue(parsed.data.widgetSecondaryColor, DEFAULT_WIDGET_SECONDARY)
        : undefined,
      widgetAvatarBase64: parsed.data.widgetAvatarBase64 ?? undefined,
      widgetAvatarEmoji: parsed.data.widgetAvatarEmoji || undefined,
      widgetTemplateConfig: parsed.data.widgetTemplateConfig
        ? (normalizeWidgetTemplateConfig(parsed.data.widgetTemplateConfig) as any)
        : undefined,
    },
  });
  res.json(agent);
});

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

agentsRouter.patch("/:id/ecommerce-config", async (req, res) => {
  const parsed = ecommerceConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const agent = await prisma.agent.findUnique({
    where: { id: req.params.id },
    select: { ecommerceConfig: true },
  });
  if (!agent) return res.status(404).json({ error: "Agente no encontrado" });

  const current = (agent.ecommerceConfig as any) ?? {};
  const incoming = parsed.data;

  // Merge: conservar apiKey cifrada existente si no viene nueva
  const newConfig: any = { ...current };
  if (incoming.businessHours !== undefined) newConfig.businessHours = incoming.businessHours;
  if (incoming.handoffSlackChannel !== undefined) newConfig.handoffSlackChannel = incoming.handoffSlackChannel;
  if (incoming.orderStatusUrl !== undefined) newConfig.orderStatusUrl = incoming.orderStatusUrl;
  if (incoming.orderStatusApiKey && incoming.orderStatusApiKey.trim() !== "") {
    // Cifrar solo si llega texto plano nuevo
    newConfig.orderStatusApiKey = encryptToken(incoming.orderStatusApiKey);
  }
  // Si orderStatusApiKey llega vacío/omitido → conservar el valor cifrado existente (sin sobreescribir)

  const updated = await prisma.agent.update({
    where: { id: req.params.id },
    data: { ecommerceConfig: newConfig },
    select: { id: true, ecommerceConfig: true },
  });

  // Enmascarar apiKey en la respuesta (nunca en claro) — R6-1
  const cfg: any = { ...((updated.ecommerceConfig as any) ?? {}) };
  if (cfg.orderStatusApiKey) cfg.orderStatusApiKey = "***";

  res.json({ id: updated.id, ecommerceConfig: cfg });
});

/* ---------- Leads por agente ---------- */

agentsRouter.get("/:id/leads", async (req, res) => {
  const leads = await prisma.lead.findMany({
    where: { agentId: req.params.id },
    orderBy: { createdAt: "desc" },
    include: { conversation: { select: { metadata: true } } },
  });
  const items = leads.map((l) => ({
    id: l.id,
    customerName: l.customerName,
    email: l.email,
    phone: l.phone,
    status: l.status,
    createdAt: l.createdAt,
    intent: (l.conversation?.metadata as any)?.leadIntent ?? null,   // R3-4
    handoff: (l.conversation?.metadata as any)?.handoff === true,    // R4-9
  }));
  res.json({ leads: items });
});
