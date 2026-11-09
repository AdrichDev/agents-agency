/**
 * S6 (model-catalog, T1) — la allowlist de la generación del CRM también es el catálogo vivo.
 *
 * `POST /api/ai/generate` (y `/api/ai/marketing-plan`) es la generación server-to-server que usa el
 * CRM con token de servicio: coste de PLATAFORMA, sin cupo del cliente. Su allowlist era
 * `KNOWN_MODEL_IDS` (la tabla a mano); con el catálogo vivo, un modelo que el proveedor ya no
 * sirve deja de estar permitido en el mismo sitio donde se decide qué se le puede pedir al
 * proveedor. El mensaje se conserva literal: el CRM ya lo conoce.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const { createModelMock } = vi.hoisted(() => ({ createModelMock: vi.fn() }));

vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: createModelMock } } },
  DEFAULT_MODEL: "gpt-5.6-luna",
  STRONG_MODEL: "gpt-5.4",
  refreshModelConfig: vi.fn(),
  getClientForAgent: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/agent/engine", () => ({ chatWithAgent: vi.fn() }));

import { aiRouter } from "@/routes/ai";
import { resetModelCatalog } from "@/lib/llm/catalog";
import { PI_DEV_MODELS_BASE, refreshModelCatalog } from "@/lib/llm/catalog-sources";

const LUNA = {
  id: "gpt-5.6-luna",
  name: "GPT-5.6 Luna",
  provider: "openai",
  reasoning: true,
  type: "chat",
  contextWindow: 400000,
  thinkingLevelMap: { off: "none", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", aiRouter);
  return app;
}

function post(app: express.Express, path: string, payload: unknown): Promise<{ status: number; body: any }> {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(raw)),
  };
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path, headers }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null });
        });
      });
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      req.write(raw);
      req.end();
    });
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetModelCatalog();
  await refreshModelCatalog({
    http: async (url) =>
      url === `${PI_DEV_MODELS_BASE}/openai?types=chat`
        ? { status: 200, etag: '"v1"', body: [LUNA] }
        : { status: 404, etag: null, body: null },
    env: {},
  });
});

describe("S6 — POST /api/ai/generate", () => {
  it("un modelo que no está en el catálogo vivo ⇒ 400 `modelo no permitido`, sin llamar al proveedor", async () => {
    const res = await post(buildApp(), "/api/ai/generate", {
      model: "gpt-4.1-nano",
      prompt: "Escribe un titular",
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "modelo no permitido" });
    expect(createModelMock).not.toHaveBeenCalled();
  });

  it("un modelo del catálogo vivo sigue generando (el rechazo no se lleva por delante el CRM)", async () => {
    createModelMock.mockResolvedValue({
      choices: [{ message: { content: "Un titular" } }],
      usage: { total_tokens: 12 },
    });

    const res = await post(buildApp(), "/api/ai/generate", {
      model: "gpt-5.6-luna",
      prompt: "Escribe un titular",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: "Un titular", usage: { tokens: 12, model: "gpt-5.6-luna" } });
    expect(createModelMock).toHaveBeenCalledTimes(1);
  });
});
