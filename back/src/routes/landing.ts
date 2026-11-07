/**
 * routes/landing.ts — Landing Builder router.
 * Thin router: zod validation + orchestration + Prisma persistence.
 * All domain logic lives in lib/landing/.
 */

import { Router, type Request, type RequestHandler, type Response } from "express";
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
import { loadReference, referenceAnswer, type ReferenceInput } from "@/lib/landing/reference";
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
import { filterSafeFiles } from "@/lib/landing/paths";
import { buildLanding, zipLanding, type BuildMode, type LandingBuild } from "@/lib/landing/build";
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

// Design reference: a public URL or an uploaded HTML file, never both.
const referenceSchema = z
  .object({
    url: z.string().url().max(2000).optional(),
    file: z
      .object({
        name: z.string().min(1).max(255),
        content: z.string().min(1).max(1_000_000),
      })
      .optional(),
  })
  .refine((r) => Boolean(r.url) !== Boolean(r.file), {
    message: "Indica una URL o un fichero de referencia, no ambos",
  });

const chatSchema = z.object({
  message: z.string().max(2000).nullable(),
  messages: z.array(chatMessageSchema).optional(),
  reference: referenceSchema.optional(),
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

// Build: `mode` is optional; when omitted it is resolved from the HTML (Tailwind CDN →
// `tailwind`, else `static`). `static` and `tailwind` build in process; `next` wraps the
// delivery in the deterministic scaffold (S7) and compiles it in Docker (S8).
const buildSchema = z.object({
  mode: z.enum(["static", "tailwind", "next"]).optional(),
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
// Body: { message, messages?, reference?: { url } | { file: { name, content } } }.
// `reference` stores design guidelines (structure, palette, fonts) in answers.reference and
// echoes them as `reference`; 400 REFERENCE_BLOCKED for non-public URLs, 422
// REFERENCE_UNREADABLE when the page cannot be read.

// A reference makes the server download up to four pages, so those requests pay the heavy
// (cost) limiter; plain interview turns keep the general /api limit.
const referenceLimiter: RequestHandler = (req, res, next) =>
  req.body?.reference ? heavyLimiter(req, res, next) : next();

landingRouter.post(
  "/:id/chat",
  referenceLimiter,
  validate.body(chatSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof chatSchema>;

    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

    // The reference is resolved before anything is persisted: a blocked or unreadable URL
    // leaves the project untouched.
    const reference = data.reference
      ? await loadReference(data.reference as ReferenceInput)
      : undefined;

    const answers = parseAnswers(project.answers);
    if (reference) answers.reference = referenceAnswer(reference);
    const clientCtx = await getClientContext(project.business);
    const turn = await runInterviewTurn(answers, data.message, data.messages ?? [], clientCtx);
    const nextAnswers = reference
      ? { ...turn.answers, reference: referenceAnswer(reference) }
      : turn.answers;

    const updateData: Record<string, unknown> = { answers: nextAnswers };
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
      answers: nextAnswers,
      area: turn.area,
      ...(reference ? { reference } : {}),
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
// Toda clave de `files` es una ruta relativa POSIX: una clave insegura reescribe la
// petición completa con 400 INVALID_FILE_PATH y no se persiste nada. `.env` es válido.

landingRouter.patch(
  "/:id/files",
  validate.body(filesSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof filesSchema>;

    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

    const { files, dropped } = filterSafeFiles(data.files);
    if (dropped.length > 0) {
      throw new HttpError(400, "Rutas de fichero no permitidas", "INVALID_FILE_PATH", {
        paths: dropped,
      });
    }

    const serialized = JSON.stringify(files);
    const truncated = serialized.length > MAX_FILES_BYTES;

    if (truncated) {
      res.json({ ok: false, truncated: true, warning: "Files exceed 300KB limit. Save rejected to prevent data corruption." });
      return;
    }

    await prisma.landingProject.update({
      where: { id: req.params.id },
      data: { files },
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

// ── POST /:id/build — Build the landing and stream it as a ZIP ────────────────
// Body: `{ mode?: "static" | "tailwind" | "next" }`. Everything lives under
// `<slug>/`; nothing is persisted (404 unknown project, 422 NOTHING_TO_BUILD without
// index.html). The `tailwind` path compiles in process and, like the image downloader, pays
// the heavy limiter; it also caps HTML + script.js at 1 MB (422 BUILD_INPUT_TOO_LARGE).
// The `next` path adds the exported site under `<slug>/` and its source project under
// `<slug>-next/`; its Docker runner answers 503 NEXT_BUILDER_UNAVAILABLE, 422
// NEXT_BUILD_FAILED and 504 NEXT_BUILD_TIMEOUT.

landingRouter.post(
  "/:id/build",
  heavyLimiter,
  validate.body(buildSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.validatedBody as z.infer<typeof buildSchema>;

    const project = await prisma.landingProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) throw new HttpError(404, "LandingProject not found");

    let build: LandingBuild;
    try {
      build = await buildLanding(project, { mode: data.mode as BuildMode | undefined });
    } catch (err) {
      // The central error handler hides `code` on 5xx; NEXT_BUILDER_UNAVAILABLE (503) and
      // NEXT_BUILD_TIMEOUT (504) are client-facing contract the builder UI needs, so those
      // codes are sent from here.
      if (err instanceof HttpError && err.status >= 500 && err.status < 600 && err.code) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
    const zip = await zipLanding(build);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${build.slug}.zip"`);
    res.send(zip);
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
