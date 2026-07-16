import { Router } from "express";
import { z } from "zod";
import { base64ImageSchema } from "@/lib/schemas";
import { asyncHandler, validate, HttpError } from "@/lib/http";
import { prisma } from "@/lib/db";
import { provisionManagedDbBackend } from "@/lib/agent-backend/provisioning";
import {
  listAgents,
  createAgent,
  getAgentDetail,
  updateAgent,
  deleteAgent,
  updateWidgetConfig,
  updateEcommerceConfig,
  listAgentLeads,
  recheckOpenclawProvisioning,
  setAgentSkills,
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

/**
 * F4 (aa-agent-backend-foundation): backend de datos del agente. v1 dos modos:
 *  - managed_db: aprovisionamos BD gestionada; requiere ≥ 1 capability.
 *  - none_yet: "solo información / FAQ", sin capabilities.
 * external_api = backlog v2 (design.md §B.5) — NO se acepta aquí.
 *
 * Backward-compat (GAP #2): el campo es OPCIONAL a nivel de API y default
 * `none_yet` cuando el caller lo omite — así los llamadores no-wizard
 * (n8n / scripts) no rompen con 400. El wizard sigue forzando la elección
 * explícita en el cliente; un `managed_db` mal formado (sin capabilities)
 * se sigue rechazando por el discriminatedUnion.
 */
const dataBackendSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none_yet") }),
  z.object({
    mode: z.literal("managed_db"),
    capabilities: z
      .array(z.enum(["reservas", "leads", "pedidos"]))
      .min(1, "Elige al menos una capacidad (reservas, leads o pedidos)"),
  }),
]);

export const createAgentSchema = z.object({
  name: z.string().min(1),
  sector: z.string().min(1),
  systemPrompt: z.string().min(1),
  model: z.string().default("gpt-4.1-nano"),
  // F2 (aa-openclaw-brain): control-plane switch — "openclaw" enruta al gateway local
  // (ver lib/openai.ts getClientForAgent) y provisiona el agente en OpenClaw (F2-T1).
  runtime: z.enum(["openai", "openclaw"]).default("openai"),
  // "" (el panel ya no expone el selector de effort; el front puede mandar
  // cadena vacía) se trata como ausente → cae al default.
  reasoningEffort: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["none", "low", "medium", "high", "xhigh"]).default("low")
  ),
  temperature: z.number().min(0).max(1).default(0.7),
  channel: z.string().default("widget"),
  tenantId: z.string().min(1).optional(),
  clientName: z.string().optional(),
  website: websiteSchema,
  // F4: Skills oculto del wizard — el campo sigue aceptado (opcional, default [])
  // para no romper llamadas existentes; motor/datos/marketplace intactos.
  skillIds: z.array(z.string()).default([]),
  dataBackend: dataBackendSchema.default({ mode: "none_yet" }),
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
  // "" → ausente (el panel ya no expone el selector de effort).
  reasoningEffort: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["none", "low", "medium", "high", "xhigh"]).optional()
  ),
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

/**
 * Re-sincroniza el agente contra OpenClaw y devuelve el estado actualizado
 * (aa-openclaw-provision-hardening). Lo usan el botón "Re-sincronizar" del
 * detalle y el paso post-creación del wizard.
 */
agentsRouter.post(
  "/:id/openclaw/recheck",
  asyncHandler(async (req, res) => {
    res.json({ openclawProvisioning: await recheckOpenclawProvisioning(req.params.id) });
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

/* ---------- Skills instaladas (aa-agent-skills-install-execute, F2) ---------- */

/**
 * Edita el conjunto CURADO de skills del agente (reemplazo declarativo). El
 * cliente natural es un multi-select con "Guardar": envía el conjunto deseado
 * completo, no deltas. `[]` desinstala todo. Mismo patrón que PATCH /:id/backend.
 */
export const setAgentSkillsSchema = z.object({
  skillIds: z.array(z.string().min(1)),
});

agentsRouter.put(
  "/:id/skills",
  validate.body(setAgentSkillsSchema),
  asyncHandler(async (req, res) => {
    const { skillIds } = req.validatedBody as z.infer<typeof setAgentSkillsSchema>;
    res.json(await setAgentSkills(req.params.id, skillIds));
  })
);

/* ---------- Backend de datos (F5, tab "Datos del negocio") ---------- */

/**
 * Config editable del AgentDataBackend desde el panel: capabilities (solo
 * managed_db) y destino de notificaciones al dueño del negocio. El dispatcher
 * real de avisos es F6 — aquí SOLO se persiste la config (a dónde/cómo).
 */
export const updateBackendSchema = z
  .object({
    capabilities: z.array(z.enum(["reservas", "leads", "pedidos"])).optional(),
    notificationConfig: z
      .object({
        telegramChatId: z.string().max(64).optional(),
        events: z.array(z.enum(["nueva_reserva", "nuevo_lead", "handoff"])).optional(),
      })
      .optional(),
  })
  .refine((v) => v.capabilities !== undefined || v.notificationConfig !== undefined, {
    message: "Nada que actualizar (capabilities o notificationConfig)",
  });

agentsRouter.patch(
  "/:id/backend",
  validate.body(updateBackendSchema),
  asyncHandler(async (req, res) => {
    const data = req.validatedBody as z.infer<typeof updateBackendSchema>;
    const backend = await prisma.agentDataBackend.findUnique({ where: { agentId: req.params.id } });
    if (!backend) throw new HttpError(404, "El agente no tiene backend de datos");
    if (data.capabilities !== undefined && backend.mode !== "managed_db") {
      throw new HttpError(400, "Las capabilities solo aplican a managed_db");
    }

    const updated = await prisma.agentDataBackend.update({
      where: { agentId: req.params.id },
      data: {
        ...(data.capabilities !== undefined ? { capabilities: data.capabilities } : {}),
        ...(data.notificationConfig !== undefined
          ? {
              // Merge superficial: no pisa claves que este PATCH no trae.
              notificationConfig: {
                ...(((backend.notificationConfig as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
                ...data.notificationConfig,
              },
            }
          : {}),
      },
    });

    res.json({
      mode: updated.mode,
      capabilities: updated.capabilities ?? [],
      notificationConfig: updated.notificationConfig ?? {},
      provisioned: Boolean(updated.dbUrlEncrypted),
    });
  })
);

/**
 * Dispara el aprovisionamiento de la BD gestionada (en creación quedó
 * dbUrlEncrypted=null). Honesto: sin AGENT_BACKEND_ADMIN_DB_URL devuelve 503
 * con el paso manual, nunca aprovisiona a medias.
 */
agentsRouter.post(
  "/:id/backend/provision",
  asyncHandler(async (req, res) => {
    const result = await provisionManagedDbBackend(req.params.id);
    if (result.status === "invalid_mode") throw new HttpError(400, result.reason ?? "Modo inválido");
    if (result.status === "unavailable") {
      return res.status(503).json({ status: result.status, error: result.reason });
    }
    res.json(result);
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
