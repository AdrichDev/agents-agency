/**
 * auth-gate.test.ts — Phase 4 (Supabase token gate)
 *
 * Tests the central /api gate that replaced cookie/JWT sessions with Supabase
 * Bearer token verification. Uses jose to craft HS256 tokens with the test secret
 * set in tests/setup.ts. Mocks prisma to avoid real DB calls.
 *
 * Pattern: build a minimal Express app that mirrors the index.ts gate logic,
 * so that index.ts is NOT imported (avoids listen() and real DB connection).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mock prisma — the gate calls prisma.user.findUnique to resolve aa.User.role.
// vi.mock must be at top-level (hoisted by Vite/vitest).
// ---------------------------------------------------------------------------
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock ONLY the token verifier (Supabase JWKS/ES256 verification needs a live
// project + asymmetric keys; covered by integration). requireRole stays real.
vi.mock("@/lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth")>();
  return { ...actual, verifySupabaseToken: vi.fn() };
});

import { prisma } from "@/lib/db";
import { verifySupabaseToken, requireRole } from "@/lib/auth";

const mockVerify = verifySupabaseToken as ReturnType<typeof vi.fn>;

// Make the verifier accept any token and return the given sub (valid case).
function verifyOk(sub: string, email = "admin@test.com") {
  mockVerify.mockResolvedValue({ sub, email, role: "authenticated" });
}
// Make the verifier reject (invalid/expired/malformed case).
function verifyReject() {
  mockVerify.mockRejectedValue(new Error("invalid token"));
}

// ---------------------------------------------------------------------------
// Mini Express app that mirrors the index.ts /api gate logic (isolated from DB).
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());

  const PUBLIC = new Set(["POST /api/auth/login", "GET /api/widget/config"]);
  const isPublic = (method: string, path: string) => PUBLIC.has(`${method} ${path}`);

  // Mirrors the index.ts gate: Bearer token → verifySupabaseToken → prisma.user.findUnique → req.user
  app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
    const fullPath = req.originalUrl.split("?")[0];

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const token = authHeader.slice(7);
        const { sub, email } = await verifySupabaseToken(token);
        const aaUser = await (prisma.user.findUnique as ReturnType<typeof vi.fn>)({
          where: { id: sub },
        });
        if (aaUser) {
          (req as any).user = {
            id: aaUser.id,
            firstName: aaUser.firstName,
            lastName: aaUser.lastName,
            email: email || aaUser.email,
            role: aaUser.role,
          };
        }
      } catch {
        // invalid/expired token — no user set
      }
    }

    if (isPublic(req.method, fullPath)) return next();
    if (!(req as any).user) return res.status(401).json({ error: "No autenticado" });
    next();
  });

  app.post("/api/auth/login", (_req, res) => res.json({ public: true }));
  app.get("/api/widget/config", (_req, res) => res.json({ public: true }));
  app.get("/api/agents", (req, res) => res.json({ ok: true, user: (req as any).user }));
  app.post("/api/config", requireRole("admin"), (_req, res) => res.json({ saved: true }));

  return app;
}

// ---------------------------------------------------------------------------
// HTTP helper (no supertest dependency — mirrors existing test pattern).
// ---------------------------------------------------------------------------
function request(
  app: express.Express,
  method: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        { host: "127.0.0.1", port, method, path, headers },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            let body: any = null;
            try {
              body = data ? JSON.parse(data) : null;
            } catch {
              body = data;
            }
            resolve({ status: res.statusCode ?? 0, body });
          });
        }
      );
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const KNOWN_UUID = "00000000-0000-4000-8000-000000000001";
const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000099";

const mockAdminUser = {
  id: KNOWN_UUID,
  firstName: "Admin",
  lastName: "User",
  email: "admin@test.com",
  role: "admin",
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("auth gate — Supabase Bearer token", () => {
  it("401 on protected route without token", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app, "GET", "/api/agents");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("No autenticado");
  });

  it("200 on protected route with valid token and known aa.User", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockAdminUser);
    verifyOk(KNOWN_UUID);
    const app = buildApp();
    const res = await request(app, "GET", "/api/agents", { Authorization: "Bearer valid" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.role).toBe("admin");
    expect(res.body.user.id).toBe(KNOWN_UUID);
  });

  it("401 on protected route with expired token", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockAdminUser);
    verifyReject();
    const app = buildApp();
    const res = await request(app, "GET", "/api/agents", { Authorization: "Bearer expired" });
    expect(res.status).toBe(401);
  });

  it("401 when token is valid but UUID not in aa.User (no app profile)", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    verifyOk(UNKNOWN_UUID);
    const app = buildApp();
    const res = await request(app, "GET", "/api/agents", { Authorization: "Bearer valid" });
    expect(res.status).toBe(401);
  });

  it("401 with malformed / wrong-secret token", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    verifyReject();
    const app = buildApp();
    const res = await request(app, "GET", "/api/agents", {
      Authorization: "Bearer not.a.valid.jwt.token",
    });
    expect(res.status).toBe(401);
  });

  it("PUBLIC_RULES: POST /api/auth/login passes without token", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app, "POST", "/api/auth/login");
    expect(res.status).toBe(200);
    expect(res.body.public).toBe(true);
  });

  it("PUBLIC_RULES: GET /api/widget/config passes without token", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app, "GET", "/api/widget/config");
    expect(res.status).toBe(200);
  });
});

describe("requireRole — app-level role enforcement", () => {
  it("403 for a non-admin role", async () => {
    const viewerUser = { ...mockAdminUser, role: "viewer" };
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(viewerUser);
    verifyOk(KNOWN_UUID);
    const app = buildApp();
    const res = await request(app, "POST", "/api/config", { Authorization: "Bearer valid" });
    expect(res.status).toBe(403);
  });

  it("200 for admin role", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockAdminUser);
    verifyOk(KNOWN_UUID);
    const app = buildApp();
    const res = await request(app, "POST", "/api/config", { Authorization: "Bearer valid" });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
  });

  it("401 no token on role-protected route", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app, "POST", "/api/config");
    expect(res.status).toBe(401);
  });
});
