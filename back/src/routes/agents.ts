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
import { asyncHandler, validate, HttpError } from "@/lib/http";
import { nextClientCode, nextQuoteNumber, withCodeRetry } from "@/lib/codes";

const DEFAULT_TOKEN_BALANCE = 10_000_000;

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
  })
);

agentsRouter.post(
  "/",
  validate.body(createAgentSchema),
  asyncHandler(async (req, res) => {
    const { clientName, website, skillIds, ...data } =
      req.validatedBody as z.infer<typeof createAgentSchema>;

    // Si se crea cliente nuevo: generar codCliente secuencial + 10M tokens por defecto.
    let newClientData: Record<string, unknown> | undefined;
    if (clientName) {
      const codCliente = await withCodeRetry(() => nextClientCode());
      newClientData = {
        name: clientName,
        website,
        sector: data.sector,
        codCliente,
        tokenBalance: DEFAULT_TOKEN_BALANCE,
        isActive: true,
      };
    }

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
        client: newClientData ? { create: newClientData as any } : undefined,
        skills: { create: skillIds.map((skillId: string) => ({ skillId })) },
      },
      include: { client: true },
    });

    // Crear presupuesto borrador automático vinculado al cliente.
    const clientId = agent.clientId ?? (agent as any).client?.id;
    if (clientId) {
      const quoteNumber = await withCodeRetry(() => nextQuoteNumber());
      await prisma.budget.create({
        data: {
          quoteNumber,
          clientId,
          clientSnapshot: (agent as any).client
            ? { name: (agent as any).client.name, codCliente: (agent as any).client.codCliente }
            : {},
          status: "draft",
          lines: {
            create: [
              {
                serviceId: "chatbot",
                name: `Chatbot IA — ${agent.name}`,
                description: `Asistente inteligente sector ${agent.sector}`,
                quantity: 1,
                implPrice: 0,
                maintPrice: 0,
                position: 0,
              },
            ],
          },
        },
      });
    }

    if (website) ingestWebsite(agent.id, website).catch(() => {});
    res.status(201).json(agent);
  })
);

agentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
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
    if (!agent) throw new HttpError(404, "No encontrado");

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
  })
);

const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  temperature: z.number().min(0).max(1).optional(),
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh"]).optional(),
  channel: z.string().min(1).optional(),
});

agentsRouter.patch(
  "/:id",
  validate.body(updateAgentSchema),
  asyncHandler(async (req, res) => {
    const data = req.validatedBody as z.infer<typeof updateAgentSchema>;
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data,
    });
    res.json(agent);
  })
);

agentsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.agent.delete({ where: { id: req.params.id } });
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
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data: {
        widgetPrimaryColor: data.widgetPrimaryColor
          ? normalizeColorValue(data.widgetPrimaryColor, DEFAULT_WIDGET_PRIMARY)
          : undefined,
        widgetSecondaryColor: data.widgetSecondaryColor
          ? normalizeColorValue(data.widgetSecondaryColor, DEFAULT_WIDGET_SECONDARY)
          : undefined,
        widgetAvatarBase64: data.widgetAvatarBase64 ?? undefined,
        widgetAvatarEmoji: data.widgetAvatarEmoji || undefined,
        widgetTemplateConfig: data.widgetTemplateConfig
          ? (normalizeWidgetTemplateConfig(data.widgetTemplateConfig) as any)
          : undefined,
      },
    });
    res.json(agent);
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

    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      select: { ecommerceConfig: true },
    });
    if (!agent) throw new HttpError(404, "Agente no encontrado");

    const current = (agent.ecommerceConfig as any) ?? {};

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
  })
);

/* ---------- Leads por agente ---------- */

agentsRouter.get(
  "/:id/leads",
  asyncHandler(async (req, res) => {
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
  })
);
