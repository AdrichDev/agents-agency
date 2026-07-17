/**
 * T1.3 — aa-agente-consola-pruebas F1 (design.md §B.2, validation.md AC4/Escenario 2).
 * GET /api/channels/telegram/conversations (bandeja del cliente) excluye por defecto
 * las conversaciones de prueba de la consola del operador (`isTest=true`).
 *
 * Patrón HTTP crudo — mismo patrón que tests/widget-install-ping.test.ts.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { channelsRouter } from "@/routes/channels";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/channels", channelsRouter);
  return app;
}

function rawGet(app: express.Express, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
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
      req.end();
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/channels/telegram/conversations", () => {
  it("filtra isTest=false (excluye conversaciones de la consola de pruebas)", async () => {
    asMock(prisma.conversation.findMany).mockResolvedValue([]);

    const res = await rawGet(buildApp(), "/api/channels/telegram/conversations");

    expect(res.status).toBe(200);
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { channel: "telegram", isTest: false } })
    );
  });
});
