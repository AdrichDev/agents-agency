/**
 * H4 (aa-planes-y-cuotas, T1.2) — Asignar crédito no decide el estado de pago.
 *
 * `PATCH /api/clients/:id/credits` derivaba `isActive` del cupo:
 *     const active = isActive ?? tokenBalance > current.tokensUsed;
 * Eso mezclaba dos hechos independientes en las dos direcciones: recargar crédito reactivaba a
 * un cliente suspendido por impago, y bajarle el cupo suspendía a uno que estaba al día. El
 * bloqueo por cupo no necesita ese booleano — lo aplica `checkClientBalance`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/codes", () => ({ nextClientCode: vi.fn(), withCodeRetry: vi.fn() }));

import { prisma } from "@/lib/db";
import { clientsRouter } from "@/routes/clients";

const mockFind = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.tenant.update as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/clients", clientsRouter);
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

/** Argumento `data` de la única llamada a tenant.update. */
function updateData() {
  return mockUpdate.mock.calls[0][0].data as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFind.mockResolvedValue({ id: "t1" });
  mockUpdate.mockResolvedValue({
    id: "t1",
    tokenBalance: 1_000,
    tokensUsed: 0,
    isActive: false,
  });
});

describe("PATCH /clients/:id/credits — el crédito no toca el estado de pago", () => {
  it("subir el saldo sin isActive no reactiva a un cliente suspendido", async () => {
    const res = await rawRequest(buildApp(), "PATCH", "/api/clients/t1/credits", {
      tokenBalance: 5_000_000,
    });

    expect(res.status).toBe(200);
    // La clave del change: `isActive` no aparece en el update.
    expect(updateData()).toEqual({ tokenBalance: 5_000_000 });
    expect(updateData()).not.toHaveProperty("isActive");
  });

  it("bajar el saldo por debajo del consumo no suspende a un cliente al día", async () => {
    mockFind.mockResolvedValue({ id: "t1" });

    await rawRequest(buildApp(), "PATCH", "/api/clients/t1/credits", { tokenBalance: 10 });

    expect(updateData()).not.toHaveProperty("isActive");
  });

  it("isActive explícito sí manda: sigue siendo el kill switch manual", async () => {
    await rawRequest(buildApp(), "PATCH", "/api/clients/t1/credits", {
      tokenBalance: 1_000,
      isActive: false,
    });

    expect(updateData()).toEqual({ tokenBalance: 1_000, isActive: false });
  });

  it("isActive: true explícito reactiva (decisión humana, no inferencia)", async () => {
    await rawRequest(buildApp(), "PATCH", "/api/clients/t1/credits", {
      tokenBalance: 1_000,
      isActive: true,
    });

    expect(updateData()).toEqual({ tokenBalance: 1_000, isActive: true });
  });

  // T6.4: el switch del panel manda SÓLO isActive. Antes recibía 400 (tokenBalance obligatorio),
  // así que el kill switch manual —la única vía de suspensión tras T1— estaba inoperable.
  it("sólo isActive, sin tokenBalance: se acepta y no toca el cupo", async () => {
    const res = await rawRequest(buildApp(), "PATCH", "/api/clients/t1/credits", {
      isActive: false,
    });

    expect(res.status).toBe(200);
    expect(updateData()).toEqual({ isActive: false });
  });

  it("body vacío se rechaza: un update sin campos no es una operación", async () => {
    const res = await rawRequest(buildApp(), "PATCH", "/api/clients/t1/credits", {});

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("cliente inexistente devuelve 404 sin escribir", async () => {
    mockFind.mockResolvedValue(null);

    const res = await rawRequest(buildApp(), "PATCH", "/api/clients/tX/credits", {
      tokenBalance: 100,
    });

    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
