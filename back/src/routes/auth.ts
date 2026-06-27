import { Router } from "express";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { verifySupabaseToken, supabaseAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { changePwLimiter, forgotLimiter } from "@/lib/limiters";

/* ---------- Auth (AA back — Phase 4 Supabase migration) ---------- */
// The AA front signs in via supabase.auth.signInWithPassword() directly.
// These endpoints handle: /me (profile via token), login + logout stubs (410 Gone),
// PATCH /profile (edit own data), POST /change-password (verify old + update).

export const authRouter = Router();

// POST /login — 410 Gone (migrated to Supabase Auth SDK on the frontend).
// The AA front calls supabase.auth.signInWithPassword() directly; the backend
// does not participate in credential exchange. Consistent with CRM Phase 2 pattern.
authRouter.post("/login", (_req, res) => {
  res.status(410).json({
    error: {
      code: "login_moved",
      message: "Login is handled by the Supabase Auth SDK on the frontend. This endpoint is deprecated.",
    },
  });
});

// GET /me — returns the aa.User profile for the authenticated user.
// Requires Authorization: Bearer <supabase_access_token>.
authRouter.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No autenticado" });
  }

  // (a) Token verification → 401 on failure (client error).
  let sub: string;
  let email: string;
  try {
    ({ sub, email } = await verifySupabaseToken(authHeader.slice(7)));
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }

  // (b) Profile lookup → 500 on DB failure (a valid token we couldn't serve), NOT 401.
  try {
    const aaUser = await prisma.user.findUnique({ where: { id: sub } });
    if (!aaUser) {
      // Valid Supabase token but no aa.User profile — reject (spec scenario).
      return res.status(401).json({ error: "No autenticado" });
    }
    res.json({
      user: {
        id: aaUser.id,
        firstName: aaUser.firstName,
        lastName: aaUser.lastName,
        email: email || aaUser.email,
        phone: aaUser.phone,
        role: aaUser.role,
      },
    });
  } catch (e) {
    logger.error({ err: e }, "[/me] error consultando aa.User:");
    return res.status(500).json({ error: "Error interno" });
  }
});

// PATCH /profile — authenticated user edits their own data (firstName, lastName, phone).
// Uses req.user from the auth gate; ignores any id in the body (never touches another user).
const profileSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().optional(),
  phone: z.string().trim().max(30).optional(),
});

authRouter.patch("/profile", async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: { code: "validation", message: "Datos inválidos" } });
  }

  const d = parsed.data;
  if (d.firstName === undefined && d.lastName === undefined && d.phone === undefined) {
    return res.status(422).json({ error: { code: "empty", message: "Nada que actualizar" } });
  }

  try {
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(d.firstName !== undefined ? { firstName: d.firstName } : {}),
        ...(d.lastName !== undefined ? { lastName: d.lastName } : {}),
        ...(d.phone !== undefined ? { phone: d.phone } : {}),
      },
    });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (e) {
    logger.error({ err: e }, "[PATCH /profile] error actualizando aa.User:");
    return res.status(500).json({ error: "Error interno" });
  }
});

// POST /change-password — authenticated user changes their own password.
// Verifies old password via an ephemeral Supabase client (never touches front session).
// Then updates via admin API + invalidates other sessions.
const changeSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string(),
  repeatPassword: z.string(),
});

// Password policy: minimum 12 characters, at least one letter and one digit.
function validatePassword(pw: string): string | null {
  if (pw.length < 12) return "La contraseña debe tener al menos 12 caracteres";
  if (!/[a-zA-Z]/.test(pw)) return "La contraseña debe contener al menos una letra";
  if (!/[0-9]/.test(pw)) return "La contraseña debe contener al menos un número";
  return null;
}

authRouter.post("/change-password", changePwLimiter, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: { code: "validation", message: "Datos inválidos" } });
  }

  const { oldPassword, newPassword, repeatPassword } = parsed.data;

  if (newPassword !== repeatPassword) {
    return res.status(422).json({ error: { code: "mismatch", message: "Las contraseñas no coinciden" } });
  }

  const pwError = validatePassword(newPassword);
  if (pwError) {
    return res.status(422).json({ error: { code: "weak_password", message: pwError } });
  }

  const userId = req.user.id;

  // Fetch email from DB (source of truth — do not trust req.user.email alone).
  const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!dbUser?.email) {
    return res.status(404).json({ error: { code: "no_user", message: "Usuario no encontrado" } });
  }

  // Verify the CURRENT password via an ephemeral Supabase client.
  // persistSession:false + autoRefreshToken:false → stateless, never touches the
  // front session (no onAuthStateChange triggered in the browser).
  const ephemeral = createClient(
    process.env.SUPABASE_URL ?? "https://placeholder.supabase.co",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder-service-role-key",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: reauthError } = await ephemeral.auth.signInWithPassword({
    email: dbUser.email,
    password: oldPassword,
  });
  if (reauthError) {
    return res.status(401).json({ error: { code: "wrong_password", message: "La contraseña actual es incorrecta" } });
  }

  // Update the password via the admin API (never log newPassword).
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword });
  if (updateError) {
    logger.error({ err: updateError.message }, "[change-password] updateUserById error:");
    return res.status(500).json({ error: { code: "update_failed", message: "No se pudo actualizar la contraseña" } });
  }

  // Invalidate all other sessions. Non-blocking: password already changed;
  // if sign-out fails, log it but consider the operation successful.
  const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(userId, "others");
  if (signOutError) {
    logger.error({ err: signOutError.message }, "[change-password] signOut(others) error:");
  }

  res.status(204).end();
});

// POST /forgot-password — fire-and-forget password reset email via Supabase.
// Always returns 200 regardless of whether the email exists (anti-enumeration).
// Public route: no auth required.
const forgotSchema = z.object({
  email: z.string().email(),
});

authRouter.post("/forgot-password", forgotLimiter, (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (parsed.success) {
    const email = parsed.data.email.toLowerCase();
    // fire-and-forget: always 200 regardless of whether email exists.
    void supabaseAdmin.auth.resetPasswordForEmail(email);
  }
  res.status(200).json({ message: "Si el email existe, enviaremos instrucciones" });
});

// POST /logout — 410 Gone (migrated to supabase.auth.signOut() on the frontend).
// AA front calls supabase.auth.signOut() directly; no server-side session to clear.
authRouter.post("/logout", (_req, res) => {
  res.status(410).json({
    error: {
      code: "logout_moved",
      message: "Logout is handled by the Supabase Auth SDK on the frontend. This endpoint is deprecated.",
    },
  });
});
