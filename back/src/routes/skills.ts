import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { addGithubRepoSkill, discoverSkills, discoverGoogleSkills } from "@/lib/github-skills/scraper";
import { importSkillsFromWebsite } from "@/lib/github-skills/web-import";

/* ---------- Skills ---------- */

export const skillsRouter = Router();

const SKILL_TYPE_VALUES = ["SKILL", "AGENT", "EXTENSION", "PLUGIN", "MCP"];

skillsRouter.get("/", async (req, res) => {
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

skillsRouter.patch("/:id/favorite", async (req, res) => {
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

skillsRouter.get("/uses", async (_req, res) => {
  res.json(await listDistinctUses());
});

// Alias legado (el front antiguo llamaba a /categories)
skillsRouter.get("/categories", async (_req, res) => {
  res.json(await listDistinctUses());
});

skillsRouter.post("/", async (req, res) => {
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
