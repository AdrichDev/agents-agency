import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { collectRealData, regenerateSection } from "@/lib/market-study/study-generator";
import { searchProspects, isConfigured, geocodeZone } from "@/lib/market-study/places";
import { mergeProspects, purgeOutOfRadius, type RadiusContext } from "@/lib/market-study/prospects";
import { computeProspectStats, renderProspectStats } from "@/lib/market-study/agency-profile";
import { runStudyGeneration } from "@/lib/market-study/generate-orchestrator";
import { parseSections, parseProspects, toCSV } from "@/lib/market-study/serialization";
import type { MarketStudyInputs } from "@/lib/market-study/types";
import { heavyLimiter } from "@/lib/limiters";

export const marketStudiesRouter = Router();

// ── Schemas ───────────────────────────────────────────────────────────────

const inputsSchema = z.object({
  zone: z.string().min(1),
  postalCode: z.string().optional(),
  radiusKm: z.number().int().positive(),
  expansionZones: z.array(z.string()).default([]),
  targetSectors: z.array(z.string()).min(1, "Selecciona al menos un sector"),
  avgBudget: z.number().positive().optional(),
});

const reasoningEffortSchema = z.enum(["none", "low", "medium", "high", "xhigh"]);

const createSchema = z.object({
  title: z.string().min(1),
  inputs: inputsSchema,
  model: z.string().min(1).optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
});

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  successScore: z.number().int().min(1).max(5).nullable().optional(),
  inputs: inputsSchema.optional(),
  model: z.string().min(1).optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
});

const generateBodySchema = z.object({
  feedback: z.string().max(2000).optional(),
  refreshProspects: z.boolean().optional(),
  // When true, the prompt-master builds the optimal iteration prompt from the
  // current selection + our core business and regenerates with it immediately.
  generatePrompt: z.boolean().optional(),
});

// ── CRUD ──────────────────────────────────────────────────────────────────

marketStudiesRouter.get("/", async (_req, res) => {
  try {
    const studies = await prisma.marketStudy.findMany({
      select: { id: true, title: true, status: true, successScore: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(studies);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});

marketStudiesRouter.post("/", heavyLimiter, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const study = await prisma.marketStudy.create({
      data: {
        title: parsed.data.title,
        inputs: parsed.data.inputs as any,
        sections: [],
        prospects: [],
        status: "draft",
        ...(parsed.data.model ? { model: parsed.data.model } : {}),
        ...(parsed.data.reasoningEffort ? { reasoningEffort: parsed.data.reasoningEffort } : {}),
      },
    });
    res.status(201).json(study);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});

marketStudiesRouter.get("/:id", async (req, res) => {
  try {
    const study = await prisma.marketStudy.findUnique({ where: { id: req.params.id } });
    if (!study) return res.status(404).json({ error: "Estudio no encontrado" });
    res.json({
      ...study,
      placesConfigured: isConfigured(),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});

marketStudiesRouter.patch("/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { title, successScore, inputs, model, reasoningEffort } = parsed.data;
  if (!title && successScore === undefined && !inputs && !model && !reasoningEffort) {
    return res.status(400).json({ error: "Proporciona al menos title, successScore, inputs, model o reasoningEffort" });
  }

  try {
    const data: Record<string, unknown> = {};
    if (title) data.title = title;
    if (successScore !== undefined) data.successScore = successScore;
    if (inputs) data.inputs = inputs as any;
    if (model) data.model = model;
    if (reasoningEffort) data.reasoningEffort = reasoningEffort;

    const study = await prisma.marketStudy.update({
      where: { id: req.params.id },
      data,
    });
    res.json(study);
  } catch {
    res.status(404).json({ error: "Estudio no encontrado" });
  }
});

marketStudiesRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.marketStudy.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Estudio no encontrado" });
  }
});

// ── Generate ──────────────────────────────────────────────────────────────

marketStudiesRouter.post("/:id/generate", heavyLimiter, async (req, res) => {
  const parsedBody = generateBodySchema.safeParse(req.body ?? {});
  if (!parsedBody.success) return res.status(400).json({ error: parsedBody.error.flatten() });
  const { feedback, refreshProspects, generatePrompt } = parsedBody.data;

  try {
    const study = await prisma.marketStudy.findUnique({ where: { id: req.params.id } });
    if (!study) return res.status(404).json({ error: "Estudio no encontrado" });

    await prisma.marketStudy.update({
      where: { id: req.params.id },
      data: { status: "generating" },
    });

    const { sections, prospects, successScore, placesWarning, generatedPrompt } =
      await runStudyGeneration(
        {
          inputs: study.inputs as unknown as MarketStudyInputs,
          sections: study.sections,
          prospects: study.prospects,
          model: study.model,
          reasoningEffort: study.reasoningEffort,
        },
        { feedback, refreshProspects, generatePrompt }
      );

    const updated = await prisma.marketStudy.update({
      where: { id: req.params.id },
      data: {
        sections: sections as any,
        prospects: prospects as any,
        status: "ready",
        ...(successScore !== null ? { successScore } : {}),
      },
    });

    res.json({ ...updated, placesWarning, placesConfigured: isConfigured(), generatedPrompt });
  } catch (e) {
    await prisma.marketStudy.update({
      where: { id: req.params.id },
      data: { status: "error" },
    }).catch(() => {});
    res.status(500).json({ error: e instanceof Error ? e.message : "Error al generar" });
  }
});

// ── Sections ──────────────────────────────────────────────────────────────

marketStudiesRouter.patch("/:id/sections/:key", async (req, res) => {
  const { markdown } = req.body ?? {};
  if (typeof markdown !== "string") return res.status(400).json({ error: "markdown requerido" });

  try {
    const study = await prisma.marketStudy.findUnique({ where: { id: req.params.id } });
    if (!study) return res.status(404).json({ error: "Estudio no encontrado" });

    const sections = parseSections(study.sections);
    const idx = sections.findIndex((s) => s.key === req.params.key);
    if (idx === -1) return res.status(404).json({ error: "Sección no encontrada" });

    sections[idx] = { ...sections[idx], markdown };

    await prisma.marketStudy.update({
      where: { id: req.params.id },
      data: { sections: sections as any },
    });
    res.json({ ok: true, section: sections[idx] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});

marketStudiesRouter.post("/:id/sections/:key/regenerate", heavyLimiter, async (req, res) => {
  try {
    const study = await prisma.marketStudy.findUnique({ where: { id: req.params.id } });
    if (!study) return res.status(404).json({ error: "Estudio no encontrado" });

    const inputs = study.inputs as unknown as MarketStudyInputs;
    const realData = await collectRealData();
    const currentSections = parseSections(study.sections);
    const stats = computeProspectStats(parseProspects(study.prospects));
    const prospectStatsBlock = stats
      ? renderProspectStats(stats, inputs.radiusKm, inputs.zone)
      : undefined;
    const newSection = await regenerateSection(req.params.key, inputs, realData, currentSections, prospectStatsBlock, { model: study.model, reasoningEffort: study.reasoningEffort });

    const idx = currentSections.findIndex((s) => s.key === req.params.key);
    if (idx !== -1) {
      currentSections[idx] = newSection;
    } else {
      currentSections.push(newSection);
    }

    await prisma.marketStudy.update({
      where: { id: req.params.id },
      data: { sections: currentSections as any },
    });
    res.json({ ok: true, section: newSection });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error al regenerar sección" });
  }
});

// ── Prospects ─────────────────────────────────────────────────────────────

marketStudiesRouter.post("/:id/prospect", async (req, res) => {
  if (!isConfigured()) {
    return res.status(200).json({
      prospects: [],
      warning: "Requiere GOOGLE_MAPS_API_KEY para activar prospección",
    });
  }

  try {
    const study = await prisma.marketStudy.findUnique({ where: { id: req.params.id } });
    if (!study) return res.status(404).json({ error: "Estudio no encontrado" });

    const inputs = study.inputs as unknown as MarketStudyInputs;
    const existingProspects = parseProspects(study.prospects);

    const result = await searchProspects(inputs.zone, inputs.targetSectors ?? [], {
      radiusKm: inputs.radiusKm,
      postalCode: inputs.postalCode,
    });

    // Tag/merge against the current radius so out-of-radius items are flagged.
    const center = await geocodeZone(inputs.zone, inputs.postalCode);
    const radiusCtx: RadiusContext | undefined = center ? { center, radiusKm: inputs.radiusKm } : undefined;
    const merged = mergeProspects(existingProspects, result.prospects, radiusCtx);

    await prisma.marketStudy.update({
      where: { id: req.params.id },
      data: { prospects: merged as any },
    });

    res.json({
      prospects: merged,
      partial: result.partial,
      warning: result.warning,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error en prospección" });
  }
});

// Remove prospects that fall outside the current action radius (contacted ones
// are protected). Returns the cleaned list + how many were removed.
marketStudiesRouter.post("/:id/prospects/purge-out-of-radius", async (req, res) => {
  try {
    const study = await prisma.marketStudy.findUnique({ where: { id: req.params.id } });
    if (!study) return res.status(404).json({ error: "Estudio no encontrado" });

    const prospects = parseProspects(study.prospects);
    const { kept, removed } = purgeOutOfRadius(prospects);

    await prisma.marketStudy.update({
      where: { id: req.params.id },
      data: { prospects: kept as any },
    });

    res.json({ ok: true, prospects: kept, removed });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error al purgar prospectos" });
  }
});

marketStudiesRouter.patch("/:id/prospects/:placeId", async (req, res) => {
  const statusSchema = z.enum(["new", "contacted", "discarded"]);
  const parsed = statusSchema.safeParse(req.body?.status);
  if (!parsed.success) return res.status(400).json({ error: "status debe ser new | contacted | discarded" });

  try {
    const study = await prisma.marketStudy.findUnique({ where: { id: req.params.id } });
    if (!study) return res.status(404).json({ error: "Estudio no encontrado" });

    const prospects = parseProspects(study.prospects);
    const idx = prospects.findIndex((p) => p.placeId === req.params.placeId);
    if (idx === -1) return res.status(404).json({ error: "Prospecto no encontrado" });

    prospects[idx] = { ...prospects[idx], status: parsed.data };

    await prisma.marketStudy.update({
      where: { id: req.params.id },
      data: { prospects: prospects as any },
    });
    res.json({ ok: true, prospect: prospects[idx] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});

marketStudiesRouter.get("/:id/prospects/export", async (req, res) => {
  try {
    const study = await prisma.marketStudy.findUnique({ where: { id: req.params.id } });
    if (!study) return res.status(404).json({ error: "Estudio no encontrado" });

    const prospects = parseProspects(study.prospects);
    const csv = toCSV(prospects);

    const filename = `prospectos-${req.params.id}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("﻿" + csv); // BOM for Excel compatibility
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});
