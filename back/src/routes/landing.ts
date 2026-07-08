/**
 * routes/landing.ts — Landing Builder router.
 * Thin router: zod validation + orchestration + Prisma persistence.
 * All domain logic lives in lib/landing/.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { asyncHandler, validate, HttpError } from "@/lib/http";

async function getClientContext(tenantId?: string | null): Promise<string | null> {
  if (!tenantId) return null;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return null;
  return `DATOS REALES DEL CLIENTE (USAR EN EL CÓDIGO HTML):
- Nombre comercial: ${tenant.name}
- Sector/Vertical: ${tenant.sector || 'No especificado'}
- Email de contacto: ${tenant.email || 'No especificado'}
- Teléfono: ${tenant.phone || 'No especificado'}
- Dirección: ${tenant.direccion || 'No especificado'}
- Web actual: ${tenant.website || 'No especificado'}

(IMPORTANTE: Utiliza esta información real de la empresa para rellenar los datos de contacto, pies de página, cabeceras y textos genéricos de la landing. No inventes datos si los tienes aquí.)`;
}

import { runInterviewTurn } from "@/lib/landing/interview";
import { buildGenerationPrompts } from "@/lib/landing/prompt-master";
import {
  generateFiles,
  type DbProvider,
} from "@/lib/landing/generator";
import {
  generateMobileScaffold,
  type MobileStack,
  type MobileTarget,
} from "@/lib/landing/mobile";
import { MAX_FILES_BYTES } from "@/lib/landing/llm-files";
import { parseAnswers, parseFiles, buildMobileBranding } from "@/lib/landing/serialization";
import { createLandingQrBudget } from "@/lib/landing/budget";
import { processLandingAsset } from "@/lib/landing/assets";
import { switchDataLayer } from "@/lib/landing/data-layer";
import { heavyLimiter } from "@/lib/limiters";
import { deletePublicAssetFolder } from "@/lib/storage";

export const landingRouter = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const dbProviderEnum = z.enum(["none", "local-postgres", "firebase", "supabase", "creador-crm", "webhook"]);
const stackEnum = z.enum(["expo", "flutter"]);
const targetEnum = z.enum(["android", "ios"]);

const createSchema = z.object({
  name: z.string().min(1).max(200),
  business: z.string().optional(),
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

const qrSchema = z.object({
  qrUrl: z.string().max(2000).nullable(),
});

const assetSchema = z.object({
  dataUrl: z.string().min(1),
});

// ── POST / — Create landing project ──────────────────────────────────────────

landingRouter.post(
  "/",
  validate.body(createSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof createSchema>;

    const project = await prisma.landingProject.create({
      data: { name: data.name, business: data.business, status: "draft" },
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
    const clientCtx = await getClientContext(project.business);
    const turn = await runInterviewTurn(answers, data.message, data.messages ?? [], clientCtx);

    const updateData: Record<string, unknown> = { answers: turn.answers };
    if (turn.area === "businessName" && turn.answers["businessName"]) {
      updateData.name = turn.answers["businessName"].value;
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
  heavyLimiter,
  validate.body(generateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof generateSchema>;

    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

    try {
      let finalPrompt = data.generationPrompt;
      const clientCtx = await getClientContext(project.business);
      if (clientCtx) {
        finalPrompt += `\n\n${clientCtx}`;
      }

      const result = await generateFiles(
        finalPrompt,
        data.dbProvider as DbProvider,
        { businessId: project.business ?? undefined }
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

// ── PATCH /:id/qr — URL editable del QR ───────────────────────────────────────

landingRouter.patch(
  "/:id/qr",
  validate.body(qrSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof qrSchema>;

    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

    const hadQr = !!project.qrUrl;
    await prisma.landingProject.update({
      where: { id: req.params.id },
      data: { qrUrl: data.qrUrl },
    });

    // Crear presupuesto borrador automático la primera vez que se añade QR.
    if (!hadQr && data.qrUrl) {
      await createLandingQrBudget(project.name);
    }

    res.json({ ok: true, qrUrl: data.qrUrl });
  })
);

// ── POST /:id/assets — Sube y optimiza una imagen → URL pública self-hosted ────

landingRouter.post(
  "/:id/assets",
  heavyLimiter,
  validate.body(assetSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof assetSchema>;

    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

    const url = await processLandingAsset(req.params.id, data.dataUrl);

    res.status(201).json({ ok: true, url });
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
        businessId: project.business ?? undefined,
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
    const branding = buildMobileBranding(answers, project.business);

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
      const result = await switchDataLayer(
        generationPrompt,
        data.dbProvider as DbProvider,
        previousFiles,
        data.confirm,
        project.business ?? undefined
      );

      if (result.kind === "collision") {
        res.status(409).json({ collisions: result.collisions, diff: result.diff });
        return;
      }

      await prisma.landingProject.update({
        where: { id: req.params.id },
        data: { files: result.files, dbProvider: data.dbProvider },
      });

      res.json({ files: result.files, truncated: result.truncated });
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
    // GC: borra los assets del proyecto en Storage (best-effort).
    await deletePublicAssetFolder(`landing/${req.params.id}`);
    res.status(204).send();
  })
);
