import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { collectRealData, generateStudy, regenerateSection } from "@/lib/market-study/study-generator";
import { searchProspects, isConfigured } from "@/lib/market-study/places";
import { mergeProspects } from "@/lib/market-study/prospects";
import { buildCompetitorSection } from "@/lib/market-study/competitors";
import type { StudySection, Prospect, MarketStudyInputs } from "@/lib/market-study/types";

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

const createSchema = z.object({
  title: z.string().min(1),
  inputs: inputsSchema,
});

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  successScore: z.number().int().min(1).max(5).nullable().optional(),
  inputs: inputsSchema.optional(),
});

const generateBodySchema = z.object({
  feedback: z.string().max(2000).optional(),
  refreshProspects: z.boolean().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────

function parseSections(raw: unknown): StudySection[] {
  if (Array.isArray(raw)) return raw as StudySection[];
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

function parseProspects(raw: unknown): Prospect[] {
  if (Array.isArray(raw)) return raw as Prospect[];
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

function escapeCSV(v: string | number | undefined | null): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCSV(prospects: Prospect[]): string {
  const header = "name,address,phone,rating,sector,placeId,status,websiteStatus,opportunityScore";
  const rows = prospects.map((p) =>
    [p.name, p.address, p.phone, p.rating, p.sector, p.placeId, p.status, p.websiteStatus ?? "", p.opportunityScore ?? ""].map(escapeCSV).join(",")
  );
  return [header, ...rows].join("\n");
}

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

marketStudiesRouter.post("/", async (req, res) => {
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

  const { title, successScore, inputs } = parsed.data;
  if (!title && successScore === undefined && !inputs) {
    return res.status(400).json({ error: "Proporciona al menos title, successScore o inputs" });
  }

  try {
    const data: Record<string, unknown> = {};
    if (title) data.title = title;
    if (successScore !== undefined) data.successScore = successScore;
    if (inputs) data.inputs = inputs as any;

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

marketStudiesRouter.post("/:id/generate", async (req, res) => {
  const parsedBody = generateBodySchema.safeParse(req.body ?? {});
  if (!parsedBody.success) return res.status(400).json({ error: parsedBody.error.flatten() });
  const { feedback, refreshProspects } = parsedBody.data;

  try {
    const study = await prisma.marketStudy.findUnique({ where: { id: req.params.id } });
    if (!study) return res.status(404).json({ error: "Estudio no encontrado" });

    await prisma.marketStudy.update({
      where: { id: req.params.id },
      data: { status: "generating" },
    });

    const inputs = study.inputs as unknown as MarketStudyInputs;
    const realData = await collectRealData();

    // Iterative mode: the study already has generated sections
    const previousSections = parseSections(study.sections);
    const isIteration = previousSections.length > 0;

    // Build competitor section (uses Places if available)
    const competitorSection = await buildCompetitorSection(inputs.zone, inputs, isConfigured());

    // Generate study sections + successScore (iterating over previous content if any)
    const { sections, successScore } = await generateStudy(
      inputs,
      realData,
      competitorSection,
      isIteration ? { previousSections, feedback } : undefined
    );

    // Prospect discovery (best-effort) with enhanced classification.
    // On iterations, Places is only re-queried when refreshProspects === true
    // (it consumes quota); existing prospects and their statuses are kept.
    let prospects = parseProspects(study.prospects);
    let placesWarning: string | undefined;
    const wantsProspects = !isIteration || refreshProspects === true;

    if (wantsProspects && isConfigured() && inputs.targetSectors?.length) {
      const result = await searchProspects(inputs.zone, inputs.targetSectors, {
        radiusKm: inputs.radiusKm,
        postalCode: inputs.postalCode,
      });
      placesWarning = result.warning;
      // Merge by placeId: refresh data, never lose existing statuses
      prospects = mergeProspects(prospects, result.prospects);
    } else if (wantsProspects && !isConfigured()) {
      placesWarning = "Requiere GOOGLE_MAPS_API_KEY para activar prospección";
    }

    const updated = await prisma.marketStudy.update({
      where: { id: req.params.id },
      data: {
        sections: sections as any,
        prospects: prospects as any,
        status: "ready",
        ...(successScore !== null ? { successScore } : {}),
      },
    });

    res.json({ ...updated, placesWarning, placesConfigured: isConfigured() });
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

marketStudiesRouter.post("/:id/sections/:key/regenerate", async (req, res) => {
  try {
    const study = await prisma.marketStudy.findUnique({ where: { id: req.params.id } });
    if (!study) return res.status(404).json({ error: "Estudio no encontrado" });

    const inputs = study.inputs as unknown as MarketStudyInputs;
    const realData = await collectRealData();
    const currentSections = parseSections(study.sections);
    const newSection = await regenerateSection(req.params.key, inputs, realData, currentSections);

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
    const existingIds = new Set(existingProspects.map((p) => p.placeId));

    const result = await searchProspects(inputs.zone, inputs.targetSectors ?? [], {
      radiusKm: inputs.radiusKm,
      postalCode: inputs.postalCode,
    });

    for (const p of result.prospects) {
      if (!existingIds.has(p.placeId)) {
        existingProspects.push(p);
        existingIds.add(p.placeId);
      }
    }

    await prisma.marketStudy.update({
      where: { id: req.params.id },
      data: { prospects: existingProspects as any },
    });

    res.json({
      prospects: existingProspects,
      partial: result.partial,
      warning: result.warning,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error en prospección" });
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
