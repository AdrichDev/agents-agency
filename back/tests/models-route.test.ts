/**
 * S7 (model-catalog, T1) — `GET /api/models`, el catálogo que consumen los selectores.
 *
 * Contrato con el CRM (y con el selector del front de AA, T3): proveedores → modelos
 * `{id, name, provider, reasoning, efforts, defaultEffort, contextWindow, verified}`, sin precios
 * y sin claves. Autenticado: usuario del panel (sesión, como el resto de `/api`) o el token de
 * servicio del CRM (`AA_SERVICE_TOKEN`, el mismo que abre `/api/ai/generate`).
 *
 * El gate de `/api` vive en `index.ts` y no se puede importar aquí (llamaría a `listen` y abriría
 * la BD), así que —igual que `auth-gate.test.ts`— la app de prueba monta un espejo del gate con
 * las MISMAS piezas reales (`isPublic`, `isServiceCall`, `isCatalogPath`): si la excepción de
 * `/api/models` desapareciera del gate, el token de servicio dejaría de llegar al router y la
 * prueba se caería.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { resetModelCatalog } from "@/lib/llm/catalog";
import { PI_DEV_MODELS_BASE, refreshModelCatalog } from "@/lib/llm/catalog-sources";
import { isCatalogPath, modelsRouter } from "@/routes/models";
import { isPublic, isServiceCall } from "@/lib/public-routes";

const LUNA = {
  id: "gpt-5.6-luna",
  name: "GPT-5.6 Luna",
  provider: "openai",
  reasoning: true,
  type: "chat",
  contextWindow: 400000,
  cost: { input: 0.1, output: 0.4 },
  thinkingLevelMap: { off: "none", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
};

/** Catálogo vivo mínimo: pi.dev sólo responde por OpenAI. */
const catalogoVivo = async (url: string) =>
  url === `${PI_DEV_MODELS_BASE}/openai?types=chat`
    ? { status: 200, etag: '"v1"', body: [LUNA] }
    : { status: 404, etag: null, body: null };

function buildApp() {
  const app = express();
  app.use(express.json());

  // Espejo del gate de index.ts (mismas piezas reales, sin arrancar el server ni tocar la BD).
  app.use("/api", (req, res, next) => {
    const fullPath = req.originalUrl.split("?")[0];
    if (isServiceCall(req.method, fullPath, req.headers.authorization)) return next();

    if (req.headers["x-panel-user"] === "si") {
      req.user = { id: "u1", email: "op@estudio.com", role: "admin" } as never;
    }

    if (isPublic(req.method, fullPath) || isCatalogPath(req.method, fullPath)) return next();
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    next();
  });

  app.use("/api/models", modelsRouter);
  return app;
}

function request(
  app: express.Express,
  path: string,
  headers: Record<string, string> = {},
  method = "GET"
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
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
          resolve({ status: res.statusCode ?? 0, body: parsed, raw: data });
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

const SAVED = { ...process.env };

beforeEach(async () => {
  resetModelCatalog();
  await refreshModelCatalog({ http: catalogoVivo, env: {} });
  process.env.AA_SERVICE_TOKEN = "svc-token-de-prueba";
});

afterEach(() => {
  process.env = { ...SAVED };
});

describe("S7 — autenticación", () => {
  it("sin sesión ni token de servicio ⇒ 401 `No autenticado`", async () => {
    const res = await request(buildApp(), "/api/models");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No autenticado" });
  });

  it("un token de servicio que no coincide ⇒ 401", async () => {
    const res = await request(buildApp(), "/api/models", { Authorization: "Bearer no-es-el-token" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No autenticado" });
  });

  it("el token de servicio del CRM abre el catálogo (mismo AA_SERVICE_TOKEN que /api/ai/generate)", async () => {
    const res = await request(buildApp(), "/api/models", {
      Authorization: "Bearer svc-token-de-prueba",
    });

    expect(res.status).toBe(200);
    expect(res.body.providers.map((p: any) => p.id)).toContain("openai");
  });

  it("un usuario del panel (sesión) lo abre", async () => {
    const res = await request(buildApp(), "/api/models", { "x-panel-user": "si" });

    expect(res.status).toBe(200);
  });

  it("la excepción del gate es sólo para `GET /api/models`", () => {
    expect(isCatalogPath("GET", "/api/models")).toBe(true);
    expect(isCatalogPath("POST", "/api/models")).toBe(false);
    expect(isCatalogPath("GET", "/api/models/algo")).toBe(false);
  });
});

describe("S7 — forma de la respuesta", () => {
  it("devuelve proveedores → modelos con los ocho campos del contrato, sin precio ni claves", async () => {
    const res = await request(buildApp(), "/api/models", { "x-panel-user": "si" });

    expect(res.status).toBe(200);
    // El respaldo es POR proveedor: openai viene del catálogo vivo y gemini/anthropic de la tabla
    // estática, porque pi.dev no contestó por ellos en este escenario. Lo que se fija aquí es el
    // contrato del proveedor vivo.
    expect(res.body.providers.find((p: any) => p.id === "openai")).toEqual({
      id: "openai",
      name: "OpenAI",
      models: [
        {
          id: "gpt-5.6-luna",
          name: "GPT-5.6 Luna",
          provider: "openai",
          reasoning: true,
          efforts: ["none", "low", "medium", "high", "xhigh"],
          defaultEffort: "low",
          contextWindow: 400000,
          verified: false,
        },
      ],
    });

    // El contrato es CERRADO: ni coste, ni claves, ni campos internos de pi.dev.
    const modelo = res.body.providers.find((p: any) => p.id === "openai").models[0];
    expect(Object.keys(modelo).sort()).toEqual([
      "contextWindow",
      "defaultEffort",
      "efforts",
      "id",
      "name",
      "provider",
      "reasoning",
      "verified",
    ]);
    expect(res.raw).not.toMatch(/cost|price|apiKey|authorization|sk-/i);
  });

  it("sin catálogo vivo responde igual con la tabla estática (el selector nunca se queda sin lista)", async () => {
    resetModelCatalog();

    const res = await request(buildApp(), "/api/models", { "x-panel-user": "si" });

    expect(res.status).toBe(200);
    const ids = res.body.providers.flatMap((p: any) => p.models.map((m: any) => m.id));
    expect(ids).toEqual(expect.arrayContaining(["gpt-5.6-luna", "claude-opus-5", "gemini-3.5-flash"]));
    expect(res.body.providers.every((p: any) => p.models.every((m: any) => m.verified === false))).toBe(true);
  });
});
