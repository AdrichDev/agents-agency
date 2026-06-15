import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { base64ImageSchema } from "@/lib/schemas";
import { asyncHandler, validate } from "@/lib/http";

/* ---------- Configuración del Sistema ---------- */

export const configRouter = Router();

configRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
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
  })
);

const configUpsertSchema = z.object({
  theme: z.string().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  fontFamily: z.string().optional(),
  favicon: base64ImageSchema.nullable().optional(),
  sidebarLogo: base64ImageSchema.nullable().optional(),
  sidebarBg: z.string().optional(),
  pageBg: z.string().optional(),
  sidebarBgLight: z.string().optional(),
  pageBgLight: z.string().optional(),
  adminEmail: z.string().email().nullable().optional().or(z.literal("")),
});

configRouter.post(
  "/",
  requireRole("admin"),
  validate.body(configUpsertSchema),
  asyncHandler(async (req, res) => {
    const { theme, primaryColor, secondaryColor, fontFamily, favicon, sidebarLogo, sidebarBg, pageBg, sidebarBgLight, pageBgLight, adminEmail } =
      req.validatedBody as z.infer<typeof configUpsertSchema>;
    const config = await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { theme, primaryColor, secondaryColor, fontFamily, favicon, sidebarLogo, sidebarBg, pageBg, sidebarBgLight, pageBgLight, adminEmail },
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
        adminEmail,
      },
    });
    res.json(config);
  })
);
