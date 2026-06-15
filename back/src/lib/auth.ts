import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/lib/db";

const COOKIE_NAME = "session";
const SESSION_DAYS = 7;
const MIN_SECRET_LENGTH = 32;

/**
 * Valida que JWT_SECRET exista y sea suficientemente largo.
 * Fail-closed: lanza si falta o es débil. Llamar en el arranque del servidor
 * (assertAuthSecrets) para abortar el proceso antes de aceptar tráfico.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET ausente o demasiado corto (mínimo ${MIN_SECRET_LENGTH} caracteres). ` +
        `Genera uno fuerte, p. ej.: openssl rand -hex 32`
    );
  }
  return secret;
}

/**
 * Comprueba en el arranque todos los secretos críticos de auth.
 * Fail-closed: lanza para abortar el proceso si falta alguno.
 */
export function assertAuthSecrets(): void {
  getJwtSecret();
}

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
    getJwtSecret(),
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
    const payload = jwt.verify(token, getJwtSecret()) as any;
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

/** Middleware: exige que el usuario autenticado tenga uno de los roles dados. */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "No autenticado" });
    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: "Permisos insuficientes" });
    }
    next();
  };
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
