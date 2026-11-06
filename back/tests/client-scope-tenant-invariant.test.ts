/**
 * F-14 (auditoría integral) — invariante "un usuario con tenant NO es staff".
 *
 * El modelo de agents-agency es: `tenantId = null` ⇒ staff del estudio (ve todos los tenants),
 * `tenantId != null` ⇒ usuario de portal (solo `/api/portal`). Esa invariante vive SOLO en el
 * código: `User.tenantId` es nullable y el esquema no la puede expresar, así que una fila mal
 * creada (migración manual, bug futuro, seed) convertiría a un usuario de un cliente en "staff" y
 * le abriría todos los tenants a través de los routers de staff, que no filtran por tenant.
 *
 * La puerta pasa a decidir por el DATO (`tenantId`), no por la etiqueta (`role`): si hay tenant,
 * hay confinamiento. Así un rol inesperado no puede escalar por descuido.
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { clientScopeGate, CLIENT_ROLE } from "@/lib/client-scope";
import type { SessionUser } from "@/lib/auth";

function buildApp(user?: SessionUser) {
  const app = express();
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use("/api", clientScopeGate);
  app.all(/.*/, (_req, res) => res.json({ ok: true }));
  return app;
}

function call(app: express.Express, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      http
        .request({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null });
          });
        })
        .on("error", (e) => {
          server.close();
          reject(e);
        })
        .end();
    });
  });
}

const base = {
  id: "u1",
  firstName: "Ana",
  lastName: "Prueba",
  email: "ana@ejemplo.es",
};

describe("F-14 — con tenantId no se entra en los routers de staff, sea cual sea el rol", () => {
  const rolesInesperados = ["editor", "viewer", "admin", "manager", "operator", "staff", "owner"];

  for (const role of rolesInesperados) {
    it(`rol "${role}" con tenantId ⇒ confinado al portal`, async () => {
      const user = { ...base, role, tenantId: "t1" } as SessionUser;
      const app = buildApp(user);

      const staffRoute = await call(app, "/api/agents");
      expect(staffRoute.status).toBe(403);

      const allowed = await call(app, "/api/portal/agents");
      expect(allowed.status).toBe(200);
    });
  }

  it("el staff de verdad (tenantId null) sigue pasando como antes", async () => {
    const user = { ...base, role: "admin", tenantId: null } as SessionUser;
    const app = buildApp(user);
    expect((await call(app, "/api/agents")).status).toBe(200);
  });

  it("un client bien formado sigue confinado (regresión)", async () => {
    const user = { ...base, role: CLIENT_ROLE, tenantId: "t1" } as SessionUser;
    const app = buildApp(user);
    expect((await call(app, "/api/agents")).status).toBe(403);
    expect((await call(app, "/api/portal/agents")).status).toBe(200);
  });
});
