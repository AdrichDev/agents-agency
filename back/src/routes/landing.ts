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
import { asyncHandler, validate, HttpError } from "@/lib/http";

export const landingRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

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

landingRouter.post(
  "/",
  validate.body(createSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof createSchema>;

    const project = await prisma.landingProject.create({
      data: { name: data.name, status: "draft" },
    });

    res.status(201).json(project);
  })
);

// ── GET / — List landing projects ─────────────────────────────────────────────

landingRouter.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
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
  })
);

// ── GET /:id — Get project ─────────────────────────────────────────────────────

landingRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");
    res.json(project);
  })
);

// ── POST /:id/chat — Decálogo conversacional ──────────────────────────────────

landingRouter.post(
  "/:id/chat",
  validate.body(chatSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof chatSchema>;

    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

    const answers = parseAnswers(project.answers);
    const turn = await runInterviewTurn(answers, data.message);

    // Persist updated answers, business name, and chat history
    const updateData: Record<string, unknown> = { answers: turn.answers };
    if (turn.area === "businessName" && turn.answers["businessName"]) {
      updateData.business = turn.answers["businessName"].value;
    }
    if (data.messages !== undefined) {
      updateData.chatMessages = data.messages;
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
  })
);

// ── POST /:id/prompts — Prompt Master ─────────────────────────────────────────

landingRouter.post(
  "/:id/prompts",
  asyncHandler(async (req: Request, res: Response) => {
    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

    const answers = parseAnswers(project.answers);
    const prompts = await buildGenerationPrompts(answers);

    res.json(prompts);
  })
);

// ── POST /:id/generate — Generación de código ─────────────────────────────────

landingRouter.post(
  "/:id/generate",
  validate.body(generateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof generateSchema>;

    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

    try {
      const result = await generateFiles(
        data.generationPrompt,
        data.dbProvider as DbProvider
      );

      await prisma.landingProject.update({
        where: { id: req.params.id },
        data: {
          generationPrompt: data.generationPrompt,
          dbProvider: data.dbProvider,
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
  })
);

// ── PATCH /:id/files — Manual file edits ──────────────────────────────────────

landingRouter.patch(
  "/:id/files",
  validate.body(filesSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof filesSchema>;

    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

    const serialized = JSON.stringify(data.files);
    const truncated = serialized.length > MAX_FILES_BYTES;

    if (truncated) {
      res.json({ ok: false, truncated: true, warning: "Files exceed 300KB limit. Save rejected to prevent data corruption." });
      return;
    }

    await prisma.landingProject.update({
      where: { id: req.params.id },
      data: { files: data.files },
    });

    res.json({ ok: true, truncated: false });
  })
);

// ── POST /:id/regenerate — Regenerar con feedback ─────────────────────────────

landingRouter.post(
  "/:id/regenerate",
  validate.body(regenerateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof regenerateSchema>;

    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

    const previousFiles = parseFiles(project.files);
    const generationPrompt = project.generationPrompt ?? "";

    try {
      const result = await generateFiles(generationPrompt, project.dbProvider as DbProvider, {
        previous: previousFiles,
        feedback: data.feedback,
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
  })
);

// ── POST /:id/mobile — Generar scaffold móvil ─────────────────────────────────

landingRouter.post(
  "/:id/mobile",
  validate.body(mobileSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof mobileSchema>;

    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

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
        target: data.target as MobileTarget,
        stack: data.stack as MobileStack,
      });

      await prisma.landingProject.update({
        where: { id: req.params.id },
        data: { mobileFiles: result.files, mobileStack: data.stack },
      });

      res.json({ mobileFiles: result.files, truncated: result.truncated });
    } catch (err: unknown) {
      const raw = (err as { raw?: string }).raw ?? String(err);
      res.status(422).json({ error: "Failed to generate mobile scaffold", raw });
    }
  })
);

// ── POST /:id/db-provider — Cambiar capa de datos ────────────────────────────

landingRouter.post(
  "/:id/db-provider",
  validate.body(dbProviderSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof dbProviderSchema>;

    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

    const previousFiles = parseFiles(project.files);
    const generationPrompt = project.generationPrompt ?? "";

    try {
      const deltaResult = await generateFiles(
        generationPrompt,
        data.dbProvider as DbProvider,
        { previous: previousFiles, onlyDataLayer: true }
      );

      const deltaFiles = Object.fromEntries(
        Object.entries(deltaResult.files).filter(
          ([k]) => !(k in previousFiles) || deltaResult.files[k] !== previousFiles[k]
        )
      );

      // Check for collisions with the existing files (excluding identical content)
      const collisions = findCollisions(previousFiles, deltaFiles);

      if (collisions.length > 0 && !data.confirm) {
        const diff = buildSimpleDiff(previousFiles, deltaFiles, collisions);
        res.status(409).json({ collisions, diff });
        return;
      }

      // Apply merge
      const merged = { ...previousFiles, ...deltaFiles };

      await prisma.landingProject.update({
        where: { id: req.params.id },
        data: { files: merged, dbProvider: data.dbProvider },
      });

      res.json({ files: merged, truncated: deltaResult.truncated });
    } catch (err: unknown) {
      const raw = (err as { raw?: string }).raw ?? String(err);
      res.status(422).json({ error: "Failed to regenerate data layer", raw });
    }
  })
);

// ── DELETE /:id — Delete project ──────────────────────────────────────────────

landingRouter.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

    await prisma.landingProject.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);
