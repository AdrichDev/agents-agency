/**
 * T7 — aa-agent-backend-foundation Fase 7 (AC10).
 * Auto-verificacion de instalacion del widget:
 *  (1) POST /api/widget/ping sella `widgetInstalledAt` en el primer ping
 *      (donde era null) y `widgetLastSeenAt` en cada ping → el estado "instalado"
 *      se refleja;
 *  (2) sin publicKey → 400;
 *  (3) best-effort: un fallo de persistencia NO propaga (204, no rompe el widget);
 *  (4) la ruta esta en la allowlist publica (el widget vive sin sesion).
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { updateMany: vi.fn() },
  },
}));
// El aiRouter arrastra el pipeline de chat/generacion (engine, metering); fuera
// de scope aqui — solo probamos el endpoint de ping.
vi.mock("@/lib/agent/engine", () => ({ chatWithAgent: vi.fn() }));
vi.mock("@/lib/token-metering", () => ({ checkClientBalance: vi.fn() }));

import { prisma } from "@/lib/db";
import { aiRouter } from "@/routes/ai";
import { isPublic } from "@/lib/public-routes";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", aiRouter);
  return app;
}

function rawRequest(
  app: express.Express,
  method: string,
  path: string,
  payload?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const headers: Record<string, string> = {};
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          server.close();
          let parsed: any = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      });
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      if (body) req.write(body);
      req.end();
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("allowlist publica del ping", () => {
  it("POST /api/widget/ping es publico; GET no lo es", () => {
    expect(isPublic("POST", "/api/widget/ping")).toBe(true);
    expect(isPublic("GET", "/api/widget/ping")).toBe(false);
  });
});

describe("POST /api/widget/ping", () => {
  it("sella instalado (primer ping) y ultimo visto; responde 204", async () => {
    asMock(prisma.agent.updateMany).mockResolvedValue({ count: 1 });

    const res = await rawRequest(buildApp(), "POST", "/api/widget/ping", { publicKey: "pk-1" });

    expect(res.status).toBe(204);
    // 1er updateMany: sella instalacion SOLO donde aun era null (no pisa la fecha).
    expect(prisma.agent.updateMany).toHaveBeenNthCalledWith(1, {
      where: { publicKey: "pk-1", widgetInstalledAt: null },
      data: expect.objectContaining({
        widgetInstalledAt: expect.any(Date),
        widgetLastSeenAt: expect.any(Date),
      }),
    });
    // 2o updateMany: refresca "ultimo visto" para agentes ya instalados.
    expect(prisma.agent.updateMany).toHaveBeenNthCalledWith(2, {
      where: { publicKey: "pk-1", NOT: { widgetInstalledAt: null } },
      data: expect.objectContaining({ widgetLastSeenAt: expect.any(Date) }),
    });
  });

  it("400 si falta publicKey", async () => {
    const res = await rawRequest(buildApp(), "POST", "/api/widget/ping", {});
    expect(res.status).toBe(400);
    expect(prisma.agent.updateMany).not.toHaveBeenCalled();
  });

  it("best-effort: un fallo de persistencia NO rompe (204)", async () => {
    asMock(prisma.agent.updateMany).mockRejectedValue(new Error("db down"));

    const res = await rawRequest(buildApp(), "POST", "/api/widget/ping", { publicKey: "pk-1" });

    expect(res.status).toBe(204);
  });

  it("clave desconocida → 204 sin filtrar existencia (count 0)", async () => {
    asMock(prisma.agent.updateMany).mockResolvedValue({ count: 0 });

    const res = await rawRequest(buildApp(), "POST", "/api/widget/ping", { publicKey: "desconocida" });

    expect(res.status).toBe(204);
  });
});
