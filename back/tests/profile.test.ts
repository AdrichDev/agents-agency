/**
 * profile.test.ts — aa-perfil-editable back-end tests
 *
 * Covers:
 *  - PATCH /api/auth/profile (update own profile)
 *  - POST /api/auth/change-password (verify old + update)
 *
 * Pattern: build a minimal Express app that mirrors the index.ts gate logic
 * and mounts authRouter, so index.ts is NOT imported (avoids listen() + real DB).
 * Mocks prisma and Supabase admin/ephemeral clients.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mock prisma — avoid real DB calls
// ---------------------------------------------------------------------------
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock Supabase admin + token verifier (JWKS needs a live project).
vi.mock("@/lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth")>();
  return {
    ...actual,
    verifySupabaseToken: vi.fn(),
    supabaseAdmin: {
      auth: {
        resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
        admin: {
          updateUserById: vi.fn(),
          signOut: vi.fn(),
        },
      },
    },
  };
});

// Mock @supabase/supabase-js createClient (ephemeral client in change-password).
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { verifySupabaseToken, supabaseAdmin } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { authRouter } from "@/routes/auth";

const mockVerify = verifySupabaseToken as ReturnType<typeof vi.fn>;
const mockCreateClient = createClient as ReturnType<typeof vi.fn>;
const mockAdmin = supabaseAdmin as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const KNOWN_UUID = "00000000-0000-4000-8000-000000000001";

const mockUser = {
  id: KNOWN_UUID,
  firstName: "Admin",
  lastName: "User",
  email: "admin@test.com",
  phone: null,
  role: "admin",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function verifyOk(sub = KNOWN_UUID, email = "admin@test.com") {
  mockVerify.mockResolvedValue({ sub, email, role: "authenticated" });
}

function buildApp() {
  const app = express();
  app.use(express.json());

  // Simplified gate that mirrors index.ts — populates req.user when Bearer present.
  app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const { sub, email } = await verifySupabaseToken(authHeader.slice(7));
        const aaUser = await (prisma.user.findUnique as ReturnType<typeof vi.fn>)({ where: { id: sub } });
        if (aaUser) {
          req.user = {
            id: aaUser.id,
            firstName: aaUser.firstName,
            lastName: aaUser.lastName,
            email: email || aaUser.email,
            phone: aaUser.phone,
            role: aaUser.role,
          };
        }
      } catch {
        // invalid token — req.user stays undefined
      }
    }
    if (!req.user && req.method !== "OPTIONS") {
      // Protect all routes in this mini app
      const path = req.originalUrl.split("?")[0];
      // Only protect non-public paths
      const isPublic =
        path === "/api/auth/login" ||
        path === "/api/auth/logout" ||
        path === "/api/auth/forgot-password";
      if (!isPublic) {
        return res.status(401).json({ error: "No autenticado" });
      }
    }
    next();
  });

  app.use("/api/auth", authRouter);
  return app;
}

// HTTP helper (mirrors existing test pattern — no supertest).
function request(
  app: express.Express,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: {
            "Content-Type": "application/json",
            ...(payload ? { "Content-Length": Buffer.byteLength(payload).toString() } : {}),
            ...headers,
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            let bodyParsed: any = null;
            try {
              bodyParsed = data ? JSON.parse(data) : null;
            } catch {
              bodyParsed = data;
            }
            resolve({ status: res.statusCode ?? 0, body: bodyParsed });
          });
        }
      );
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Tests: PATCH /api/auth/profile
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PATCH /api/auth/profile", () => {
  it("401 when no auth token provided", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app, "PATCH", "/api/auth/profile", {}, { firstName: "Ana" });
    expect(res.status).toBe(401);
  });

  it("200 — updates own profile and returns updated user", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    const updatedUser = { ...mockUser, firstName: "Ana", phone: "+34600000001" };
    (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(updatedUser);
    verifyOk();

    const app = buildApp();
    const res = await request(
      app,
      "PATCH",
      "/api/auth/profile",
      { Authorization: "Bearer valid" },
      { firstName: "Ana", phone: "+34600000001" }
    );

    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe("Ana");
    expect(res.body.user.phone).toBe("+34600000001");
    // Verify update was called with req.user.id (not any body id).
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: KNOWN_UUID } })
    );
  });

  it("ignores any 'id' field in the body — always uses session user id", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    const updated = { ...mockUser, firstName: "NewName" };
    (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);
    verifyOk();

    const app = buildApp();
    const OTHER_UUID = "99999999-9999-4000-8000-999999999999";
    const res = await request(
      app,
      "PATCH",
      "/api/auth/profile",
      { Authorization: "Bearer valid" },
      { id: OTHER_UUID, firstName: "NewName" }
    );

    expect(res.status).toBe(200);
    // Must use session id, not the body id
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: KNOWN_UUID } })
    );
  });

  it("422 when body is empty (nothing to update)", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    verifyOk();

    const app = buildApp();
    const res = await request(
      app,
      "PATCH",
      "/api/auth/profile",
      { Authorization: "Bearer valid" },
      {}
    );
    expect(res.status).toBe(422);
  });

  it("422 on invalid data (firstName empty string)", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    verifyOk();

    const app = buildApp();
    const res = await request(
      app,
      "PATCH",
      "/api/auth/profile",
      { Authorization: "Bearer valid" },
      { firstName: "" }
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/auth/change-password
// ---------------------------------------------------------------------------

describe("POST /api/auth/change-password", () => {
  function setupEphemeral(success: boolean) {
    const signInMock = success
      ? vi.fn().mockResolvedValue({ error: null })
      : vi.fn().mockResolvedValue({ error: { message: "Invalid login credentials" } });

    mockCreateClient.mockReturnValue({
      auth: { signInWithPassword: signInMock },
    });
    return signInMock;
  }

  it("401 when no auth token provided", async () => {
    const app = buildApp();
    const res = await request(
      app,
      "POST",
      "/api/auth/change-password",
      {},
      { oldPassword: "OldPass123456", newPassword: "NewPass123456", repeatPassword: "NewPass123456" }
    );
    expect(res.status).toBe(401);
  });

  it("401 when old password is wrong", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockImplementation(({ where }) => {
      // First call is from the gate (resolves the session user)
      // Second call is from change-password (select email)
      return Promise.resolve({ ...mockUser, email: "admin@test.com" });
    });
    verifyOk();
    setupEphemeral(false); // ephemeral signIn fails

    const app = buildApp();
    const res = await request(
      app,
      "POST",
      "/api/auth/change-password",
      { Authorization: "Bearer valid" },
      { oldPassword: "WrongPass123", newPassword: "NewPass123456", repeatPassword: "NewPass123456" }
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("wrong_password");
  });

  it("200/204 when old password is correct and new password is valid", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    verifyOk();
    setupEphemeral(true);
    mockAdmin.auth.admin.updateUserById.mockResolvedValue({ error: null });
    mockAdmin.auth.admin.signOut.mockResolvedValue({ error: null });

    const app = buildApp();
    const res = await request(
      app,
      "POST",
      "/api/auth/change-password",
      { Authorization: "Bearer valid" },
      { oldPassword: "OldPass123456", newPassword: "NewPass123456", repeatPassword: "NewPass123456" }
    );
    expect(res.status).toBe(204);
    expect(mockAdmin.auth.admin.updateUserById).toHaveBeenCalledWith(
      KNOWN_UUID,
      { password: "NewPass123456" }
    );
  });

  it("422 when new password is too weak (less than 12 chars)", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    verifyOk();

    const app = buildApp();
    const res = await request(
      app,
      "POST",
      "/api/auth/change-password",
      { Authorization: "Bearer valid" },
      { oldPassword: "OldPass123456", newPassword: "short1", repeatPassword: "short1" }
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("weak_password");
  });

  it("422 when new password has no digit", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    verifyOk();

    const app = buildApp();
    const res = await request(
      app,
      "POST",
      "/api/auth/change-password",
      { Authorization: "Bearer valid" },
      { oldPassword: "OldPass123456", newPassword: "NoDigitsHereABC", repeatPassword: "NoDigitsHereABC" }
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("weak_password");
  });

  it("422 when passwords don't match", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    verifyOk();

    const app = buildApp();
    const res = await request(
      app,
      "POST",
      "/api/auth/change-password",
      { Authorization: "Bearer valid" },
      { oldPassword: "OldPass123456", newPassword: "NewPass123456", repeatPassword: "DifferentPass789" }
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("mismatch");
  });

  it("422 when new password has no letter (covers /[a-zA-Z]/ policy branch)", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    verifyOk();

    const app = buildApp();
    const res = await request(
      app,
      "POST",
      "/api/auth/change-password",
      { Authorization: "Bearer valid" },
      { oldPassword: "OldPass123456", newPassword: "123456789012", repeatPassword: "123456789012" }
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("weak_password");
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/auth/forgot-password
// ---------------------------------------------------------------------------

describe("POST /api/auth/forgot-password", () => {
  it("200 with neutral message for any email (anti-enumeration)", async () => {
    // mock supabaseAdmin.resetPasswordForEmail (fire-and-forget, always resolves)
    mockAdmin.auth.resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });

    const app = buildApp();
    const res = await request(
      app,
      "POST",
      "/api/auth/forgot-password",
      {},
      { email: "someone@example.com" }
    );
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/instrucciones/i);
  });

  it("200 with neutral message even for unknown email (no enumeration leak)", async () => {
    mockAdmin.auth.resetPasswordForEmail = vi.fn().mockResolvedValue({ error: { message: "User not found" } });

    const app = buildApp();
    const res = await request(
      app,
      "POST",
      "/api/auth/forgot-password",
      {},
      { email: "nobody@example.com" }
    );
    // Must still be 200 — never reveal whether email exists
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/instrucciones/i);
  });

  it("200 (neutral) even when body email is invalid — no 422 leak", async () => {
    // Invalid email → parsed.success = false → skip resetPasswordForEmail but still return 200
    mockAdmin.auth.resetPasswordForEmail = vi.fn();

    const app = buildApp();
    const res = await request(
      app,
      "POST",
      "/api/auth/forgot-password",
      {},
      { email: "not-an-email" }
    );
    expect(res.status).toBe(200);
    expect(mockAdmin.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
