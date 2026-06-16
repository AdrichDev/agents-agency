import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { base64ImageSchema } from "@/lib/schemas";
import { asyncHandler, validate } from "@/lib/http";
import { refreshModelConfig } from "@/lib/openai";
import { encryptToken, decryptToken, redirectUri } from "@/lib/integrations/oauth";

/**
 * Carga las credenciales OAuth de Google desde SystemConfig y las pone en
 * process.env, para que googleProvider (que lee process.env de forma perezosa)
 * funcione sin tocar back/.env. Llamar al arrancar y tras guardar config.
 */
export async function applyOAuthEnvFromConfig(): Promise<void> {
  try {
    const c = await prisma.systemConfig.findUnique({ where: { id: "default" } });
    if (c?.googleClientId) process.env.GOOGLE_CLIENT_ID = c.googleClientId;
    if (c?.googleClientSecret) {
      try {
        process.env.GOOGLE_CLIENT_SECRET = decryptToken(c.googleClientSecret);
      } catch {
        /* clave de cifrado ausente: se ignora */
      }
    }
  } catch {
    /* sin BD aún */
  }
}

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
    // Nunca exponer el secreto cifrado; sí un flag + el redirect URI a registrar.
    const { googleClientSecret, ...safe } = config;
    res.json({
      ...safe,
      googleConfigured: !!(config.googleClientId && googleClientSecret),
      googleRedirectUri: redirectUri("google"),
    });
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
  defaultAgentModel: z.string().optional(),
  reasoningEffort: z.enum(["minimal", "low", "medium", "high"]).optional(),
  googleClientId: z.string().optional(),
  googleClientSecret: z.string().optional(), // vacío = conservar el actual
});

configRouter.post(
  "/",
  requireRole("admin"),
  validate.body(configUpsertSchema),
  asyncHandler(async (req, res) => {
    const { theme, primaryColor, secondaryColor, fontFamily, favicon, sidebarLogo, sidebarBg, pageBg, sidebarBgLight, pageBgLight, adminEmail, defaultAgentModel, reasoningEffort, googleClientId, googleClientSecret } =
      req.validatedBody as z.infer<typeof configUpsertSchema>;
    // Secreto: solo re-cifrar si llegó uno nuevo no vacío; si no, conservar.
    const encryptedSecret =
      googleClientSecret && googleClientSecret.trim()
        ? encryptToken(googleClientSecret.trim())
        : undefined;
    const config = await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { theme, primaryColor, secondaryColor, fontFamily, favicon, sidebarLogo, sidebarBg, pageBg, sidebarBgLight, pageBgLight, adminEmail, defaultAgentModel, reasoningEffort, googleClientId, ...(encryptedSecret ? { googleClientSecret: encryptedSecret } : {}) },
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
        defaultAgentModel: defaultAgentModel ?? "gpt-5.4-mini",
        reasoningEffort: reasoningEffort ?? "low",
        googleClientId,
        googleClientSecret: encryptedSecret,
      },
    });
    // Refresca config en caliente: effort global + credenciales OAuth a process.env.
    await refreshModelConfig();
    await applyOAuthEnvFromConfig();
    const { googleClientSecret: _omit, ...safe } = config;
    res.json({ ...safe, googleConfigured: !!(config.googleClientId && config.googleClientSecret) });
  })
);
