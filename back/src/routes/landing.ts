/**
 * routes/landing.ts — Landing Builder router.
 * Thin router: zod validation + orchestration + Prisma persistence.
 * All domain logic lives in lib/landing/.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { runInterviewTurn, type AnswerEntry } from "@/lib/landing/interview";
import { buildGenerationPrompts } from "@/lib/landing/prompt-master";
import {
  generateFiles,
  findCollisions,
  buildSimpleDiff,
  type DbProvider,
} from "@/lib/landing/generator";
import {
  generateMobileScaffold,
  type MobileStack,
  type MobileTarget,
} from "@/lib/landing/mobile";
import { MAX_FILES_BYTES } from "@/lib/landing/llm-files";

export const landingRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function notFound(res: Response): void {
  res.status(404).json({ error: "LandingProject not found" });
}

function parseAnswers(raw: unknown): Record<string, AnswerEntry> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, AnswerEntry>;
  }
  return {};
}

function parseFiles(raw: unknown): Record<string, string> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, string>;
  }
  return {};
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const dbProviderEnum = z.enum(["none", "local-postgres", "firebase", "supabase"]);
const stackEnum = z.enum(["expo", "flutter"]);
const targetEnum = z.enum(["android", "ios"]);

const createSchema = z.object({
  name: z.string().min(1).max(200),
});

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const chatSchema = z.object({
  message: z.string().max(2000).nullable(),
  messages: z.array(chatMessageSchema).optional(),
});

const generateSchema = z.object({
  generationPrompt: z.string().min(1).max(8000),
  dbProvider: dbProviderEnum.default("none"),
});

const filesSchema = z.object({
  files: z.record(z.string(), z.string()),
});

const regenerateSchema = z.object({
  feedback: z.string().min(1).max(2000),
});

const mobileSchema = z.object({
  stack: stackEnum.default("expo"),
  target: targetEnum,
});

const dbProviderSchema = z.object({
  dbProvider: dbProviderEnum,
  confirm: z.boolean().optional().default(false),
});

// ── POST / — Create landing project ──────────────────────────────────────────

landingRouter.post("/", async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = await prisma.landingProject.create({
    data: { name: parsed.data.name, status: "draft" },
  });

  res.status(201).json(project);
});

// ── GET / — List landing projects ─────────────────────────────────────────────

landingRouter.get("/", async (_req: Request, res: Response) => {
  const projects = await prisma.landingProject.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      business: true,
      status: true,
      dbProvider: true,
      mobileStack: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  res.json(projects);
});

// ── GET /:id — Get project ─────────────────────────────────────────────────────

landingRouter.get("/:id", async (req: Request, res: Response) => {
  const project = await prisma.landingProject.findUnique({
    where: { id: req.params.id },
  });
  if (!project) { notFound(res); return; }
  res.json(project);
});

// ── POST /:id/chat — Decálogo conversacional ──────────────────────────────────

landingRouter.post("/:id/chat", async (req: Request, res: Response) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = await prisma.landingProject.findUnique({
    where: { id: req.params.id },
  });
  if (!project) { notFound(res); return; }

  const answers = parseAnswers(project.answers);
  const turn = await runInterviewTurn(answers, parsed.data.message);

  // Persist updated answers, business name, and chat history
  const updateData: Record<string, unknown> = { answers: turn.answers };
  if (turn.area === "businessName" && turn.answers["businessName"]) {
    updateData.business = turn.answers["businessName"].value;
  }
  if (parsed.data.messages !== undefined) {
    updateData.chatMessages = parsed.data.messages;
  }

  await prisma.landingProject.update({
    where: { id: req.params.id },
    data: updateData,
  });

  res.json({
    question: turn.question,
    done: turn.done,
    answers: turn.answers,
    area: turn.area,
  });
});

// ── POST /:id/prompts — Prompt Master ─────────────────────────────────────────

landingRouter.post("/:id/prompts", async (req: Request, res: Response) => {
  const project = await prisma.landingProject.findUnique({
    where: { id: req.params.id },
  });
  if (!project) { notFound(res); return; }

  const answers = parseAnswers(project.answers);
  const prompts = await buildGenerationPrompts(answers);

  res.json(prompts);
});

// ── POST /:id/generate — Generación de código ─────────────────────────────────

landingRouter.post("/:id/generate", async (req: Request, res: Response) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = await prisma.landingProject.findUnique({
    where: { id: req.params.id },
  });
  if (!project) { notFound(res); return; }

  try {
    const result = await generateFiles(
      parsed.data.generationPrompt,
      parsed.data.dbProvider as DbProvider
    );

    await prisma.landingProject.update({
      where: { id: req.params.id },
      data: {
        generationPrompt: parsed.data.generationPrompt,
        dbProvider: parsed.data.dbProvider,
        files: result.files,
        status: "generated",
      },
    });

    if (result.truncated) {
      res.json({ files: result.files, truncated: true, warning: "Generated files exceed 300KB limit. Some content may be incomplete." });
    } else {
      res.json({ files: result.files, truncated: false });
    }
  } catch (err: unknown) {
    const raw = (err as { raw?: string }).raw ?? String(err);
    res.status(422).json({ error: "Failed to generate landing page files", raw });
  }
});

// ── PATCH /:id/files — Manual file edits ──────────────────────────────────────

landingRouter.patch("/:id/files", async (req: Request, res: Response) => {
  const parsed = filesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = await prisma.landingProject.findUnique({
    where: { id: req.params.id },
  });
  if (!project) { notFound(res); return; }

  const serialized = JSON.stringify(parsed.data.files);
  const truncated = serialized.length > MAX_FILES_BYTES;

  if (truncated) {
    res.json({ ok: false, truncated: true, warning: "Files exceed 300KB limit. Save rejected to prevent data corruption." });
    return;
  }

  await prisma.landingProject.update({
    where: { id: req.params.id },
    data: { files: parsed.data.files },
  });

  res.json({ ok: true, truncated: false });
});

// ── POST /:id/regenerate — Regenerar con feedback ─────────────────────────────

landingRouter.post("/:id/regenerate", async (req: Request, res: Response) => {
  const parsed = regenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = await prisma.landingProject.findUnique({
    where: { id: req.params.id },
  });
  if (!project) { notFound(res); return; }

  const previousFiles = parseFiles(project.files);
  const generationPrompt = project.generationPrompt ?? "";

  try {
    const result = await generateFiles(generationPrompt, project.dbProvider as DbProvider, {
      previous: previousFiles,
      feedback: parsed.data.feedback,
    });

    await prisma.landingProject.update({
      where: { id: req.params.id },
      data: { files: result.files },
    });

    res.json({ files: result.files, truncated: result.truncated });
  } catch (err: unknown) {
    const raw = (err as { raw?: string }).raw ?? String(err);
    res.status(422).json({ error: "Failed to regenerate landing page files", raw });
  }
});

// ── POST /:id/mobile — Generar scaffold móvil ─────────────────────────────────

landingRouter.post("/:id/mobile", async (req: Request, res: Response) => {
  const parsed = mobileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = await prisma.landingProject.findUnique({
    where: { id: req.params.id },
  });
  if (!project) { notFound(res); return; }

  const answers = parseAnswers(project.answers);
  const branding = {
    businessName: answers["businessName"]?.value ?? project.business ?? "Business",
    palette: answers["palette"]?.value ?? "modern colors",
    style: answers["style"]?.value ?? "modern",
    sections: answers["sections"]?.value ?? "home, about, contact",
  };

  try {
    const result = await generateMobileScaffold({
      answers,
      branding,
      target: parsed.data.target as MobileTarget,
      stack: parsed.data.stack as MobileStack,
    });

    await prisma.landingProject.update({
      where: { id: req.params.id },
      data: { mobileFiles: result.files, mobileStack: parsed.data.stack },
    });

    res.json({ mobileFiles: result.files, truncated: result.truncated });
  } catch (err: unknown) {
    const raw = (err as { raw?: string }).raw ?? String(err);
    res.status(422).json({ error: "Failed to generate mobile scaffold", raw });
  }
});

// ── POST /:id/db-provider — Cambiar capa de datos ────────────────────────────

landingRouter.post("/:id/db-provider", async (req: Request, res: Response) => {
  const parsed = dbProviderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = await prisma.landingProject.findUnique({
    where: { id: req.params.id },
  });
  if (!project) { notFound(res); return; }

  const previousFiles = parseFiles(project.files);
  const generationPrompt = project.generationPrompt ?? "";

  try {
    const deltaResult = await generateFiles(
      generationPrompt,
      parsed.data.dbProvider as DbProvider,
      { previous: previousFiles, onlyDataLayer: true }
    );

    const deltaFiles = Object.fromEntries(
      Object.entries(deltaResult.files).filter(
        ([k]) => !(k in previousFiles) || deltaResult.files[k] !== previousFiles[k]
      )
    );

    // Check for collisions with the existing files (excluding identical content)
    const collisions = findCollisions(previousFiles, deltaFiles);

    if (collisions.length > 0 && !parsed.data.confirm) {
      const diff = buildSimpleDiff(previousFiles, deltaFiles, collisions);
      res.status(409).json({ collisions, diff });
      return;
    }

    // Apply merge
    const merged = { ...previousFiles, ...deltaFiles };

    await prisma.landingProject.update({
      where: { id: req.params.id },
      data: { files: merged, dbProvider: parsed.data.dbProvider },
    });

    res.json({ files: merged, truncated: deltaResult.truncated });
  } catch (err: unknown) {
    const raw = (err as { raw?: string }).raw ?? String(err);
    res.status(422).json({ error: "Failed to regenerate data layer", raw });
  }
});

// ── DELETE /:id — Delete project ──────────────────────────────────────────────

landingRouter.delete("/:id", async (req: Request, res: Response) => {
  const project = await prisma.landingProject.findUnique({
    where: { id: req.params.id },
  });
  if (!project) { notFound(res); return; }

  await prisma.landingProject.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
