import { Router } from "express";
import { verifySupabaseToken } from "@/lib/auth";
import { prisma } from "@/lib/db";

/* ---------- Auth (AA back — Phase 4 Supabase migration) ---------- */
// The AA front signs in via supabase.auth.signInWithPassword() directly.
// These endpoints handle: /me (profile via token), login + logout stubs (410 Gone).

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
        role: aaUser.role,
      },
    });
  } catch (e) {
    console.error("[/me] error consultando aa.User:", e);
    return res.status(500).json({ error: "Error interno" });
  }
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
