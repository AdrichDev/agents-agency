import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/lib/db";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-cambia-esto-en-produccion";
const COOKIE_NAME = "session";
const SESSION_DAYS = 7;

export interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signSession(user: SessionUser): string {
  return jwt.sign(
    {
      sub: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: `${SESSION_DAYS}d` }
  );
}

/** Parseo simple de la cabecera Cookie (evita depender de cookie-parser). */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function getSessionUser(req: Request): SessionUser | null {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    return {
      id: String(payload.sub),
      firstName: String(payload.firstName ?? ""),
      lastName: String(payload.lastName ?? ""),
      email: String(payload.email ?? ""),
      role: String(payload.role ?? "viewer"),
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

/** Middleware para proteger endpoints (uso futuro en el dashboard). */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: "No autenticado" });
  (req as any).user = user;
  next();
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
  };
}
