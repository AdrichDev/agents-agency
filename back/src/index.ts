import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { chatWithAgent } from "@/lib/agent/engine";
import { buildSkillStatus } from "@/lib/agent/skill-capabilities";
import { addGithubRepoSkill, discoverSkills, discoverGoogleSkills } from "@/lib/github-skills/scraper";
import { importSkillsFromWebsite } from "@/lib/github-skills/web-import";
import { runAutomations, runAutomation } from "@/lib/automations/engine";
import * as n8n from "@/lib/n8n/client";
import { buildWorkflow } from "@/lib/n8n/workflow-builder";
import { ingestWebsite } from "@/lib/scraper/web";
import { chunkText } from "@/lib/embeddings";
import {
  authorizationUrl,
  handleCallback,
  takeOAuthState,
  disconnectIntegration,
  encryptToken,
  decryptToken,
  PROVIDERS,
} from "@/lib/integrations/oauth";
import {
  CONNECTABLE_PROVIDERS,
  UPCOMING_PROVIDERS,
  SERVICE_TO_PROVIDER as SERVICE_TO_PROVIDER_MAP,
} from "@/lib/integrations/service-map";
import { openai, DEFAULT_MODEL } from "@/lib/openai";
import { createSector, listSectors } from "@/lib/sectors";
import {
  DEFAULT_WIDGET_AVATAR,
  DEFAULT_WIDGET_PRIMARY,
  DEFAULT_WIDGET_SECONDARY,
  normalizeColorValue,
  normalizeWidgetTemplateConfig,
} from "@/lib/widget-config";
import { saveChunkWithDuplicatePolicy } from "@/lib/knowledge-duplicates";
import {
  authenticate,
  clearSessionCookie,
  getSessionUser,
  setSessionCookie,
  signSession,
} from "@/lib/auth";
import { channelsRouter } from "@/routes/channels";
import { landingRouter } from "@/routes/landing";
import { marketStudiesRouter } from "@/routes/market-studies";
import { getStats, getDrilldown, statsQuerySchema } from "@/lib/stats";

const app = express();
// CORS con credenciales: necesario para la cookie de sesión del login
app.use(
  cors({
    origin: (origin, cb) => cb(null, true), // refleja el origin (equivale a *, pero compatible con credentials)
    credentials: true,
  })
);
// Captura rawBody para validación HMAC de webhooks WhatsApp (META_APP_SECRET)
app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
app.use(express.static(path.join(process.cwd(), "public")));

// Rutas de canales de mensajería (Telegram / WhatsApp)
app.use("/api/channels", channelsRouter);

// Rutas del Landing Builder
app.use("/api/landing", landingRouter);

// Rutas de Estudios de Mercado
app.use("/api/market-studies", marketStudiesRouter);

const PORT = Number(process.env.PORT ?? 4000);
const FRONT_URL = process.env.FRONT_URL ?? "http://localhost:3000";

/* ---------- Auth (login de la landing 3A Estudio / dashboard) ---------- */

app.post("/api/auth/login", async (req, res) => {
  const parsed = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email o contraseña no válidos" });

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) return res.status(401).json({ error: "Credenciales incorrectas" });

  setSessionCookie(res, signSession(user));
  res.json({ user });
});

app.get("/api/auth/me", (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: "No autenticado" });
  res.json({ user });
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* ---------- Leads de la landing pública 3A Estudio ---------- */

app.post("/api/public/leads", async (req, res) => {
  const parsed = z
    .object({
      name: z.string().min(2, "Indica tu nombre"),
      email: z.string().email("Email no válido"),
      phone: z.string().min(6, "Teléfono no válido"),
      consent: z.literal(true, {
        errorMap: () => ({ message: "Debes aceptar la política de privacidad" }),
      }),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos no válidos" });
  }

  try {
    const lead = await prisma.landingLead.create({ data: parsed.data });
    res.status(201).json({ ok: true, id: lead.id });
  } catch {
    res.status(500).json({ error: "No se pudo guardar el lead" });
  }
});

app.get("/api/public/leads", async (req, res) => {
  // Solo usuarios logados pueden listar leads
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: "No autenticado" });
  res.json(await prisma.landingLead.findMany({ orderBy: { createdAt: "desc" } }));
});

/* ---------- Agentes ---------- */

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
  widgetAvatarBase64: z.string().optional(),
  widgetAvatarEmoji: z.string().optional(),
  widgetTemplateConfig: z.record(z.unknown()).optional(),
});

app.get("/api/agents", async (_req, res) => {
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

app.post("/api/agents", async (req, res) => {
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

app.get("/api/agents/:id", async (req, res) => {
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

app.patch("/api/agents/:id", async (req, res) => {
  const { name, systemPrompt, temperature, model, channel } = req.body;
  const agent = await prisma.agent.update({
    where: { id: req.params.id },
    data: { name, systemPrompt, temperature, model, channel },
  });
  res.json(agent);
});

app.delete("/api/agents/:id", async (req, res) => {
  await prisma.agent.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

app.patch("/api/agents/:id/widget-config", async (req, res) => {
  const parsed = z
    .object({
      widgetPrimaryColor: z.string().optional(),
      widgetSecondaryColor: z.string().optional(),
      widgetAvatarBase64: z.string().nullable().optional(),
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

app.patch("/api/agents/:id/ecommerce-config", async (req, res) => {
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

app.get("/api/agents/:id/leads", async (req, res) => {
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

/* ---------- Mejora de prompt con IA ---------- */

app.post("/api/prompt/improve", async (req, res) => {
  const { sector, prompt, clientName, website } = req.body ?? {};
  try {
    const completion = await openai.chat.completions.create({
      model: DEFAULT_MODEL,
      max_completion_tokens: 700,
      messages: [
        {
          role: "system",
          content:
            'Eres experto en diseñar system prompts completos para agentes de IA de atención al cliente. Devuelve SOLO el system prompt mejorado, en español, en segunda persona ("Eres..."), sin explicaciones ni markdown.',
        },
        {
          role: "user",
          content: `Amplía y mejora este system prompt para un agente del sector "${sector ?? "general"}"${clientName ? ` del negocio "${clientName}"` : ""}${website ? ` (web: ${website})` : ""}. Debe incluir personalidad, tono, saludo, funciones, límites, uso de base de conocimiento, cuándo escalar a humano y el flujo de captación de lead: pedir nombre, preguntar si quiere contacto humano, solicitar email y teléfono si acepta, y despedirse correctamente. Entre 350 y 600 palabras.\n\nPrompt actual:\n${prompt || "(vacío, créalo desde cero)"}`,
        },
      ],
    });
    res.json({ prompt: completion.choices[0].message.content?.trim() ?? "" });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});

/* ---------- Chat (widget + API pública) ---------- */

app.post("/api/chat", async (req, res) => {
  const { publicKey, agentId, message, conversationId } = req.body ?? {};
  if (!message) return res.status(400).json({ error: "message requerido" });

  const agent = publicKey
    ? await prisma.agent.findUnique({ where: { publicKey } })
    : agentId
      ? await prisma.agent.findUnique({ where: { id: agentId } })
      : null;
  if (!agent) return res.status(404).json({ error: "Agente no encontrado" });

  try {
    const reply = await chatWithAgent(agent.id, message, conversationId);
    res.json(reply);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error interno" });
  }
});

app.get("/api/widget/config", async (req, res) => {
  const publicKey = String(req.query.publicKey ?? "");
  if (!publicKey) return res.status(400).json({ error: "publicKey requerido" });

  const agent = await prisma.agent.findUnique({
    where: { publicKey },
    select: {
      name: true,
      widgetPrimaryColor: true,
      widgetSecondaryColor: true,
      widgetAvatarBase64: true,
      widgetAvatarEmoji: true,
      widgetTemplateConfig: true,
    },
  });
  if (!agent) return res.status(404).json({ error: "Agente no encontrado" });

  res.json({
    name: agent.name,
    primaryColor: agent.widgetPrimaryColor || DEFAULT_WIDGET_PRIMARY,
    secondaryColor: agent.widgetSecondaryColor || DEFAULT_WIDGET_SECONDARY,
    avatarBase64: agent.widgetAvatarBase64,
    avatarEmoji: agent.widgetAvatarEmoji || DEFAULT_WIDGET_AVATAR,
    template: agent.widgetTemplateConfig || {},
  });
});

/* ---------- Sectores ---------- */

app.get("/api/sectors", async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 9);
  res.json(await listSectors({ page, pageSize }));
});

app.post("/api/sectors", async (req, res) => {
  const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await createSector(parsed.data.name));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Error al ingresar el sector" });
  }
});

/* ---------- Skills ---------- */

const SKILL_TYPE_VALUES = ["SKILL", "AGENT", "EXTENSION", "PLUGIN", "MCP"];

app.get("/api/skills", async (req, res) => {
  const { type, use, q, favorite } = req.query as {
    type?: string;
    use?: string;
    q?: string;
    favorite?: string;
  };
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = 25;

  const where: any = {};

  // Las secciones (Skills, Agentes, Extensiones, Plugins, MCP) filtran por TYPE
  if (type) {
    const t = type.trim().toUpperCase();
    if (!SKILL_TYPE_VALUES.includes(t)) {
      return res.status(400).json({ error: `type debe ser uno de: ${SKILL_TYPE_VALUES.join(", ")}` });
    }
    where.type = t;
  }

  // El select de categorías filtra por USE (uppercase)
  if (use) {
    where.use = use.trim().toUpperCase();
  }

  if (favorite === "true") {
    where.favorite = true;
  }

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" as const } },
      { description: { contains: q, mode: "insensitive" as const } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.skill.findMany({
      where,
      orderBy: { stars: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.skill.count({ where }),
  ]);

  res.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

app.patch("/api/skills/:id/favorite", async (req, res) => {
  try {
    const skill = await prisma.skill.findUnique({ where: { id: req.params.id } });
    if (!skill) return res.status(404).json({ error: "Skill no encontrada" });
    const updated = await prisma.skill.update({
      where: { id: req.params.id },
      data: { favorite: !skill.favorite },
    });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});

// Valores distintos de la columna USE (para selects dinámicos del front)
async function listDistinctUses() {
  const skills = await prisma.skill.findMany({
    select: { use: true },
    distinct: ["use"],
    where: { use: { not: "" } },
    orderBy: { use: "asc" },
  });
  return Array.from(
    new Set(
      skills
        .map((s) => s.use.trim().toUpperCase())
        .filter(Boolean)
    )
  ).sort();
}

app.get("/api/skills/uses", async (_req, res) => {
  res.json(await listDistinctUses());
});

// Alias legado (el front antiguo llamaba a /categories)
app.get("/api/skills/categories", async (_req, res) => {
  res.json(await listDistinctUses());
});

app.post("/api/skills", async (req, res) => {
  try {
    if (req.body?.action === "discover") {
      const result = await discoverSkills(req.body.limit ?? 1000);
      return res.json(result);
    }

    if (req.body?.action === "discover-google") {
      const result = await discoverGoogleSkills();
      return res.json(result);
    }

    if (req.body?.action === "addRepo") {
      const parsed = z
        .object({
          repo: z.string().min(3),
          use: z.string().min(1).optional(),
          type: z.string().min(1).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const result = await addGithubRepoSkill(parsed.data.repo, parsed.data.use, parsed.data.type);
      return res.json(result);
    }

    if (req.body?.action === "addWebsite") {
      const parsed = z.object({ url: z.string().url() }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "URL no válida" });
      const result = await importSkillsFromWebsite(parsed.data.url);
      return res.json(result);
    }

    return res.status(400).json({ error: "action debe ser 'discover', 'addRepo' o 'addWebsite'" });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});

/* ---------- Integraciones / OAuth ---------- */

/** GET /api/integrations/services — fuente única de verdad SERVICE_TO_PROVIDER (R6-1) */
app.get("/api/integrations/services", (_req, res) => {
  res.json({ serviceToProvider: SERVICE_TO_PROVIDER_MAP, upcomingProviders: Array.from(UPCOMING_PROVIDERS) });
});

/** GET /api/integrations/:agentId/status — estado de conexiones sin tokens (R5-1, AD8) */
app.get("/api/integrations/:agentId/status", async (req, res) => {
  const { agentId } = req.params;

  const rows = await prisma.integration.findMany({
    where: { agentId },
    select: { provider: true, status: true, metadata: true },
  });

  // Todos los proveedores fase inicial + posteriores
  const allProviders = [
    ...CONNECTABLE_PROVIDERS,
    ...UPCOMING_PROVIDERS,
  ] as string[];

  const integrations = allProviders.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    if (!row) {
      return { provider, status: "disconnected" as const, accountLabel: null };
    }
    const meta: any = row.metadata ?? {};
    const accountLabel: string | null =
      meta.email ?? meta.team ?? meta.workspace_name ?? meta.site ?? null;
    return {
      provider,
      status: row.status as "connected" | "reauth_required",
      accountLabel,
    };
  });

  res.json({ integrations });
});

/** DELETE /api/integrations — desconectar proveedor (con revoke si Google) */
app.delete("/api/integrations", async (req, res) => {
  const { agentId, provider } = req.body;
  if (!agentId || !provider) return res.status(400).json({ error: "agentId y provider requeridos" });
  try {
    await disconnectIntegration(agentId, provider);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error al desconectar" });
  }
});

/** GET /api/oauth/:provider — inicia flujo OAuth con nonce anti-CSRF */
app.get("/api/oauth/:provider", (req, res) => {
  const agentId = req.query.agentId as string;
  if (!agentId) return res.status(400).json({ error: "agentId requerido" });
  try {
    res.redirect(authorizationUrl(req.params.provider, agentId));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Proveedor desconocido" });
  }
});

/** GET /api/oauth/:provider/callback — callback con validación de state (AD7) */
app.get("/api/oauth/:provider/callback", async (req, res) => {
  const { code, state, error: oauthError } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  // Usuario canceló el flujo (R7-5)
  if (oauthError === "access_denied" || (!code && oauthError)) {
    // Necesitamos el agentId del state para redirigir correctamente
    const entry = state ? takeOAuthState(state) : null;
    const agentId = entry?.agentId ?? "";
    if (agentId) {
      return res.redirect(
        `${FRONT_URL}/agents/${agentId}?tab=integraciones&error=oauth_cancelled`
      );
    }
    return res.redirect(`${FRONT_URL}/?error=oauth_cancelled`);
  }

  if (!code || !state) {
    return res.redirect(`${FRONT_URL}/?error=oauth_cancelled`);
  }

  // Validar nonce (un solo uso, AD7)
  const entry = takeOAuthState(state);
  if (!entry) {
    // state inválido o expirado (CB-4)
    return res.redirect(`${FRONT_URL}/?error=invalid_state`);
  }

  const { agentId, provider } = entry;

  try {
    await handleCallback(provider, code, agentId);
    res.redirect(
      `${FRONT_URL}/agents/${agentId}?tab=integraciones&connected=${provider}`
    );
  } catch (e) {
    const msg = encodeURIComponent(e instanceof Error ? e.message : "error");
    if (e instanceof Error && e.message.includes("cifrado incompleta")) {
      return res.status(500).json({ error: "Configuración de cifrado incompleta" });
    }
    res.redirect(
      `${FRONT_URL}/agents/${agentId}?tab=integraciones&error=${msg}`
    );
  }
});

/* ---------- Automatizaciones ---------- */

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

app.post("/api/automations", async (req, res) => {
  const parsed = automationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Persistir la fila primero
  const automation = await prisma.automation.create({ data: parsed.data });

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
    console.error("[automations] build/sync error:", e);
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
});

app.patch("/api/automations", async (req, res) => {
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
});

app.delete("/api/automations", async (req, res) => {
  const { id } = req.body;
  const automation = await prisma.automation.findUnique({ where: { id } });

  // Intentar borrar en n8n best-effort (R4-3)
  if (automation?.n8nWorkflowId) {
    await n8n.deleteWorkflow(automation.n8nWorkflowId);
    // 404 o error → se loguea dentro del cliente y continuamos
  }

  await prisma.automation.delete({ where: { id } });
  res.json({ ok: true });
});

/* --- POST /api/automations/:id/execute  (llamado por n8n, R3) --- */
app.post("/api/automations/:id/execute", async (req, res) => {
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
  if (!automation) return res.status(404).json({ error: "Automation not found" });

  // Nunca 5xx al llamador n8n para evitar reintentos en bucle (R3-4)
  try {
    const result = await runAutomation(id);
    res.json(result);
  } catch (e) {
    res.json({ status: "error", summary: e instanceof Error ? e.message : String(e) });
  }
});

/* --- POST /api/automations/:id/resync  (llamado por la UI, R6-5, AD8) --- */
app.post("/api/automations/:id/resync", async (req, res) => {
  const { id } = req.params;
  const automation = await prisma.automation.findUnique({ where: { id } });
  if (!automation) return res.status(404).json({ error: "Automation not found" });

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
    console.error("[automations] resync error:", e);
    syncStatus = "error";
    workflowId = null;
  }

  await prisma.automation.update({
    where: { id },
    data: { n8nWorkflowId: workflowId, syncStatus },
  });

  res.json({ syncStatus, n8nWorkflowId: workflowId });
});

/* ---------- Conocimiento (RAG) ---------- */

app.post("/api/knowledge", async (req, res) => {
  const { agentId, url, text, source, overwriteDuplicates } = req.body ?? {};
  if (!agentId) return res.status(400).json({ error: "agentId requerido" });
  const duplicatePolicy =
    overwriteDuplicates === true ? "overwrite" : overwriteDuplicates === false ? "suffix" : "ask";
  try {
    if (url) return res.json(await ingestWebsite(agentId, url, true, { duplicatePolicy }));
    if (text) {
      const chunks = chunkText(text);
      let duplicates = 0;
      let saved = 0;
      for (const c of chunks) {
        const result = await saveChunkWithDuplicatePolicy(agentId, source ?? "documento", c, duplicatePolicy);
        if (result === "duplicate") duplicates++;
        else saved++;
      }
      return res.json({ chunks: saved, duplicates, requiresConfirmation: duplicates > 0 });
    }
    res.status(400).json({ error: "url o text requerido" });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});

/* ---------- Cron de automatizaciones (cada 5 min) ---------- */

app.get("/api/cron/automations", async (req, res) => {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const results = await runAutomations();
  res.json({ ran: results.length, results });
});

let cronBusy = false;
setInterval(async () => {
  if (cronBusy) return;
  cronBusy = true;
  try {
    const results = await runAutomations();
    if (results.length) console.log(`[cron] ${results.length} automatizaciones:`, results.map((r) => `${r.automation}=${r.status}`).join(", "));
  } catch (e) {
    console.error("[cron] error:", e);
  } finally {
    cronBusy = false;
  }
}, 5 * 60 * 1000);

/* ---------- Configuración del Sistema ---------- */

app.get("/api/config", async (_req, res) => {
  try {
    let config = await prisma.systemConfig.findUnique({ where: { id: "default" } });
    if (!config) {
      config = await prisma.systemConfig.create({
        data: {
          id: "default",
          theme: "dark",
          primaryColor: "#6366f1",
          secondaryColor: "#d946ef",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
          sidebarBg: "#05050A",
          pageBg: "#030308",
          sidebarBgLight: "#ffffff",
          pageBgLight: "#f8fafc",
        },
      });
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: "No se pudo recuperar la configuración" });
  }
});

app.post("/api/config", async (req, res) => {
  try {
    const { theme, primaryColor, secondaryColor, fontFamily, favicon, sidebarLogo, sidebarBg, pageBg, sidebarBgLight, pageBgLight } = req.body ?? {};
    const config = await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { theme, primaryColor, secondaryColor, fontFamily, favicon, sidebarLogo, sidebarBg, pageBg, sidebarBgLight, pageBgLight },
      create: {
        id: "default",
        theme: theme ?? "dark",
        primaryColor: primaryColor ?? "#6366f1",
        secondaryColor: secondaryColor ?? "#d946ef",
        fontFamily: fontFamily ?? "ui-sans-serif, system-ui, -apple-system, sans-serif",
        favicon,
        sidebarLogo,
        sidebarBg: sidebarBg ?? "#05050A",
        pageBg: pageBg ?? "#030308",
        sidebarBgLight: sidebarBgLight ?? "#ffffff",
        pageBgLight: pageBgLight ?? "#f8fafc",
      },
    });
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: "No se pudo guardar la configuración" });
  }
});

/* ---------- Clientes ---------- */

app.get("/api/clients", async (_req, res) => {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { budgets: true, agents: true } } },
    });
    res.json(clients);
  } catch {
    res.status(500).json({ error: "No se pudieron cargar los clientes" });
  }
});

app.get("/api/clients/:id", async (req, res) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: { budgets: { orderBy: { createdAt: "desc" } } },
    });
    if (!client) return res.status(404).json({ error: "Cliente no encontrado" });
    res.json(client);
  } catch {
    res.status(500).json({ error: "Error al obtener el cliente" });
  }
});

app.post("/api/clients", async (req, res) => {
  try {
    const { name, razonSocial, cif, address, email, phone, contactPerson, website, sector } = req.body;
    if (!name) return res.status(400).json({ error: "El campo 'name' es obligatorio" });
    const client = await prisma.client.create({
      data: { name, razonSocial, cif, address, email, phone, contactPerson, website, sector },
    });
    res.status(201).json(client);
  } catch {
    res.status(500).json({ error: "No se pudo crear el cliente" });
  }
});

app.put("/api/clients/:id", async (req, res) => {
  try {
    const { name, razonSocial, cif, address, email, phone, contactPerson, website, sector } = req.body;
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: { name, razonSocial, cif, address, email, phone, contactPerson, website, sector },
    });
    res.json(client);
  } catch {
    res.status(500).json({ error: "No se pudo actualizar el cliente" });
  }
});

app.delete("/api/clients/:id", async (req, res) => {
  try {
    await prisma.client.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "No se pudo eliminar el cliente" });
  }
});

/* ---------- Presupuestos ---------- */

app.get("/api/budgets", async (_req, res) => {
  try {
    const budgets = await prisma.budget.findMany({
      orderBy: { createdAt: "desc" },
      include: { client: { select: { id: true, name: true, cif: true } }, lines: true },
    });
    res.json(budgets);
  } catch {
    res.status(500).json({ error: "No se pudieron cargar los presupuestos" });
  }
});

app.get("/api/budgets/:id", async (req, res) => {
  try {
    const budget = await prisma.budget.findUnique({
      where: { id: req.params.id },
      include: { client: true, lines: { orderBy: { position: "asc" } } },
    });
    if (!budget) return res.status(404).json({ error: "Presupuesto no encontrado" });
    res.json(budget);
  } catch {
    res.status(500).json({ error: "Error al obtener el presupuesto" });
  }
});

app.post("/api/budgets", async (req, res) => {
  try {
    const {
      quoteNumber, clientId, clientSnapshot, issuerSnapshot,
      status, subtotalImpl, subtotalMaint, totalImpl, totalMaint,
      vatRate, validDays, notes, lines,
    } = req.body;

    if (!quoteNumber) return res.status(400).json({ error: "El campo 'quoteNumber' es obligatorio" });

    const budget = await prisma.budget.create({
      data: {
        quoteNumber,
        clientId: clientId || undefined,
        clientSnapshot: clientSnapshot ?? {},
        issuerSnapshot: issuerSnapshot ?? {},
        status: status ?? "draft",
        subtotalImpl: subtotalImpl ?? 0,
        subtotalMaint: subtotalMaint ?? 0,
        totalImpl: totalImpl ?? 0,
        totalMaint: totalMaint ?? 0,
        vatRate: vatRate ?? 0.21,
        validDays: validDays ?? 30,
        notes,
        lines: {
          create: Array.isArray(lines)
            ? lines.map((l: any, i: number) => ({
                serviceId: l.serviceId,
                name: l.name,
                description: l.description,
                quantity: l.quantity ?? 1,
                implPrice: l.implPrice ?? 0,
                maintPrice: l.maintPrice ?? 0,
                position: i,
              }))
            : [],
        },
      },
      include: { lines: true },
    });
    res.status(201).json(budget);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "Ya existe un presupuesto con ese número" });
    }
    res.status(500).json({ error: "No se pudo crear el presupuesto" });
  }
});

app.put("/api/budgets/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const budget = await prisma.budget.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json(budget);
  } catch {
    res.status(500).json({ error: "No se pudo actualizar el estado" });
  }
});

/* ---------- Stats ---------- */

app.get("/api/stats", async (req, res) => {
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

app.get("/api/stats/drilldown", async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`⚡ agent-agency back en http://localhost:${PORT}`);
  console.log(`   widget: http://localhost:${PORT}/widget.js`);
});
// migración skills: type (enum) + use (uppercase) — ver prisma/migrate-skill-type-use.sql
