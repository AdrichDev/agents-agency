import { Router } from "express";
import { z } from "zod";
import {
  authenticate,
  clearSessionCookie,
  getSessionUser,
  setSessionCookie,
  signSession,
} from "@/lib/auth";
import { loginLimiter } from "@/lib/limiters";

/* ---------- Auth (login de la landing 3A Estudio / dashboard) ---------- */

export const authRouter = Router();

authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email o contraseña no válidos" });

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) return res.status(401).json({ error: "Credenciales incorrectas" });

  setSessionCookie(res, signSession(user));
  res.json({ user });
});

authRouter.get("/me", (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: "No autenticado" });
  res.json({ user });
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
