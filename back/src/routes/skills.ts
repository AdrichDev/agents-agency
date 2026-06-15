import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { addGithubRepoSkill, discoverSkills, discoverGoogleSkills } from "@/lib/github-skills/scraper";
import { importSkillsFromWebsite } from "@/lib/github-skills/web-import";
import { asyncHandler, HttpError } from "@/lib/http";

/* ---------- Skills ---------- */

export const skillsRouter = Router();

const SKILL_TYPE_VALUES = ["SKILL", "AGENT", "EXTENSION", "PLUGIN", "MCP"];

skillsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
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
        throw new HttpError(400, `type debe ser uno de: ${SKILL_TYPE_VALUES.join(", ")}`);
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
  })
);

skillsRouter.patch(
  "/:id/favorite",
  asyncHandler(async (req, res) => {
    const skill = await prisma.skill.findUnique({ where: { id: req.params.id } });
    if (!skill) throw new HttpError(404, "Skill no encontrada");
    const updated = await prisma.skill.update({
      where: { id: req.params.id },
      data: { favorite: !skill.favorite },
    });
    res.json(updated);
  })
);

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

skillsRouter.get("/uses", async (_req, res) => {
  res.json(await listDistinctUses());
});

// Alias legado (el front antiguo llamaba a /categories)
skillsRouter.get("/categories", async (_req, res) => {
  res.json(await listDistinctUses());
});

skillsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
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
      if (!parsed.success) {
        throw new HttpError(400, "Datos inválidos", "VALIDATION_ERROR", parsed.error.flatten());
      }

      const result = await addGithubRepoSkill(parsed.data.repo, parsed.data.use, parsed.data.type);
      return res.json(result);
    }

    if (req.body?.action === "addWebsite") {
      const parsed = z.object({ url: z.string().url() }).safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "URL no válida", "VALIDATION_ERROR", parsed.error.flatten());
      const result = await importSkillsFromWebsite(parsed.data.url);
      return res.json(result);
    }

    throw new HttpError(400, "action debe ser 'discover', 'addRepo' o 'addWebsite'");
  })
);
