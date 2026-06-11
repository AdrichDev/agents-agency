import dotenv from "dotenv";
dotenv.config({ override: true });
import express from "express";
import cors from "cors";
import path from "path";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { chatWithAgent } from "@/lib/agent/engine";
import { addGithubRepoSkill, discoverSkills, discoverGoogleSkills } from "@/lib/github-skills/scraper";
import { runAutomations } from "@/lib/automations/engine";
import { ingestWebsite } from "@/lib/scraper/web";
import { chunkText } from "@/lib/embeddings";
import { authorizationUrl, handleCallback } from "@/lib/integrations/oauth";
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

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(process.cwd(), "public")));

const PORT = Number(process.env.PORT ?? 4000);
const FRONT_URL = process.env.FRONT_URL ?? "http://localhost:3000";

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
  res.json(agents);
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
  res.json(agent);
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

app.get("/api/skills", async (req, res) => {
  const { category, q } = req.query as { category?: string; q?: string };
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = 25;
  const where = {
    category: category || undefined,
    OR: q
      ? [
          { name: { contains: q, mode: "insensitive" as const } },
          { description: { contains: q, mode: "insensitive" as const } },
        ]
      : undefined,
  };
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

app.get("/api/skills/categories", async (_req, res) => {
  const skills = await prisma.skill.findMany({
    select: { category: true },
    distinct: ["category"],
    where: {
      category: { not: "" },
    },
    orderBy: { category: "asc" },
  });
  res.json(skills.map((s) => s.category));
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
          category: z.string().min(1).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const result = await addGithubRepoSkill(parsed.data.repo, parsed.data.category);
      return res.json(result);
    }

    return res.status(400).json({ error: "action debe ser 'discover' o 'addRepo'" });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});

/* ---------- Integraciones / OAuth ---------- */

app.delete("/api/integrations", async (req, res) => {
  const { agentId, provider } = req.body;
  await prisma.integration.delete({ where: { agentId_provider: { agentId, provider } } });
  res.json({ ok: true });
});

app.get("/api/oauth/:provider", (req, res) => {
  const agentId = req.query.agentId as string;
  if (!agentId) return res.status(400).json({ error: "agentId requerido" });
  try {
    res.redirect(authorizationUrl(req.params.provider, agentId));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Proveedor desconocido" });
  }
});

app.get("/api/oauth/:provider/callback", async (req, res) => {
  const { code, state: agentId } = req.query as { code?: string; state?: string };
  if (!code || !agentId) return res.redirect(`${FRONT_URL}/?error=oauth_cancelled`);
  try {
    await handleCallback(req.params.provider, code, agentId);
    res.redirect(`${FRONT_URL}/agents/${agentId}?tab=integraciones&connected=${req.params.provider}`);
  } catch (e) {
    const msg = encodeURIComponent(e instanceof Error ? e.message : "error");
    res.redirect(`${FRONT_URL}/agents/${agentId}?tab=integraciones&error=${msg}`);
  }
});

/* ---------- Automatizaciones ---------- */

const automationSchema = z.object({
  agentId: z.string(),
  name: z.string().min(1),
  trigger: z.enum(["new_email", "new_slack_message", "schedule"]),
  prompt: z.string().min(1),
});

app.post("/api/automations", async (req, res) => {
  const parsed = automationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await prisma.automation.create({ data: parsed.data }));
});

app.patch("/api/automations", async (req, res) => {
  const { id, enabled } = req.body;
  res.json(await prisma.automation.update({ where: { id }, data: { enabled } }));
});

app.delete("/api/automations", async (req, res) => {
  await prisma.automation.delete({ where: { id: req.body.id } });
  res.json({ ok: true });
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
    const { theme, primaryColor, secondaryColor, fontFamily, favicon, sidebarLogo } = req.body ?? {};
    const config = await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { theme, primaryColor, secondaryColor, fontFamily, favicon, sidebarLogo },
      create: {
        id: "default",
        theme: theme ?? "dark",
        primaryColor: primaryColor ?? "#6366f1",
        secondaryColor: secondaryColor ?? "#d946ef",
        fontFamily: fontFamily ?? "ui-sans-serif, system-ui, -apple-system, sans-serif",
        favicon,
        sidebarLogo,
      },
    });
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: "No se pudo guardar la configuración" });
  }
});

app.listen(PORT, () => {
  console.log(`⚡ agent-agency back en http://localhost:${PORT}`);
  console.log(`   widget: http://localhost:${PORT}/widget.js`);
});
