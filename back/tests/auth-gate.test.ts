import { describe, it, expect } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import {
  getSessionUser,
  signSession,
  requireRole,
  type SessionUser,
} from "@/lib/auth";

/**
 * Reproduce el gate central de index.ts: protege todo /api salvo la allowlist,
 * inyecta req.user si hay sesión. No importa index.ts para evitar el listen()
 * y la dependencia de DB; valida la lógica de middleware aislada.
 */
function buildApp() {
  const app = express();
  app.use(express.json());

  const PUBLIC = new Set(["POST /api/auth/login", "GET /api/widget/config"]);
  const isPublic = (method: string, path: string) => PUBLIC.has(`${method} ${path}`);

  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const fullPath = req.originalUrl.split("?")[0];
    const user = getSessionUser(req);
    if (user) (req as any).user = user;
    if (isPublic(req.method, fullPath)) return next();
    if (!user) return res.status(401).json({ error: "No autenticado" });
    next();
  });

  app.post("/api/auth/login", (_req, res) => res.json({ public: true }));
  app.get("/api/widget/config", (_req, res) => res.json({ public: true }));
  app.get("/api/agents", (req, res) => res.json({ ok: true, user: (req as any).user }));
  app.post("/api/config", requireRole("admin"), (_req, res) => res.json({ saved: true }));

  return app;
}

function cookieFor(role: string): string {
  const user: SessionUser = {
    id: "u1",
    firstName: "Test",
    lastName: "User",
    email: "t@t.com",
    role,
  };
  return `session=${encodeURIComponent(signSession(user))}`;
}

// Mini cliente HTTP sobre el server de express (sin supertest, no es dependencia).
import http from "node:http";
import type { AddressInfo } from "node:net";

function request(
  app: express.Express,
  method: string,
  path: string,
  cookie?: string
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        { host: "127.0.0.1", port, method, path, headers: cookie ? { Cookie: cookie } : {} },
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

describe("auth gate", () => {
  const app = buildApp();

  it("401 en ruta protegida sin cookie", async () => {
    const res = await request(app, "GET", "/api/agents");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("No autenticado");
  });

  it("200 en ruta protegida con sesión válida e inyecta req.user", async () => {
    const res = await request(app, "GET", "/api/agents", cookieFor("viewer"));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.role).toBe("viewer");
  });

  it("rutas públicas permanecen abiertas sin cookie", async () => {
    const login = await request(app, "POST", "/api/auth/login");
    expect(login.status).toBe(200);
    const widget = await request(app, "GET", "/api/widget/config");
    expect(widget.status).toBe(200);
  });
});

describe("config admin-role enforcement", () => {
  const app = buildApp();

  it("403 para un usuario no admin", async () => {
    const res = await request(app, "POST", "/api/config", cookieFor("viewer"));
    expect(res.status).toBe(403);
  });

  it("200 para un admin", async () => {
    const res = await request(app, "POST", "/api/config", cookieFor("admin"));
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
  });

  it("401 sin sesión", async () => {
    const res = await request(app, "POST", "/api/config");
    expect(res.status).toBe(401);
  });
});
