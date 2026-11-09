/**
 * S6 (model-catalog, T1) — el catálogo vivo es la allowlist y la fuente de los efforts.
 *
 * Antes, los ids permitidos eran `KNOWN_MODEL_IDS` (una tabla a mano) y los niveles de
 * razonamiento otra tabla a mano. Ahora salen del catálogo vivo, así que:
 *   - elegir un modelo que ya no está en el catálogo se rechaza con un 400 explícito,
 *   - un agente que YA lo tiene guardado no se toca (nada de reescribir filas por detrás),
 *   - y el comportamiento previo (ruta de Responses para gpt-5.6-luna, default `low`, respaldo
 *     estático cuando no hay catálogo) sigue exactamente igual.
 *
 * Se prueba por la puerta real (`POST/PATCH /api/agents` con el router de verdad y el
 * `errorHandler` de verdad) y por el listado real de agentes, no leyendo constantes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findMany: vi.fn(), findUnique: vi.fn() },
    conversation: { findFirst: vi.fn(), groupBy: vi.fn() },
  },
}));
vi.mock("@/lib/n8n/client", () => ({ isConfigured: vi.fn(() => false) }));
vi.mock("@/lib/integrations/oauth", () => ({
  encryptToken: vi.fn(() => "enc"),
  decryptToken: vi.fn(() => "dec"),
}));
vi.mock("@/lib/channels/telegram-pairing", () => ({ setPairing: vi.fn() }));
vi.mock("@/lib/channels/webhook-shared", () => ({ decryptCreds: vi.fn() }));
vi.mock("@/lib/channels/telegram", () => ({ validateToken: vi.fn() }));

// Mock PARCIAL: el CRUD se mockea (aquí no se prueba el alta), pero `listAgents` se usa REAL
// para demostrar que un agente con un modelo retirado se lee tal cual, sin tocarlo.
vi.mock("@/lib/agent/service", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/agent/service")>();
  return {
    ...actual,
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    getAgentDetail: vi.fn(),
    deleteAgent: vi.fn(),
    updateWidgetConfig: vi.fn(),
    updateEcommerceConfig: vi.fn(),
    listAgentLeads: vi.fn(),
    recheckOpenclawProvisioning: vi.fn(),
    setAgentSkills: vi.fn(),
  };
});

import { prisma } from "@/lib/db";
import { createAgent, listAgents, updateAgent } from "@/lib/agent/service";
import { agentsRouter } from "@/routes/agents";
import { errorHandler } from "@/lib/observability";
import { resetModelCatalog } from "@/lib/llm/catalog";
import { PI_DEV_MODELS_BASE, refreshModelCatalog, type CatalogHttp } from "@/lib/llm/catalog-sources";
import { capsFor, modelSupportsEffort, resolveEffort } from "@/lib/model-capabilities";
// S5 (model-catalog): qué endpoint sirve un modelo lo decide el PROVEEDOR (todo OpenAI por
// `/v1/responses`), así que la pregunta vive junto a `providerForModel`.
import { governChatBody, usesResponsesApi } from "@/lib/llm/governance";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** pi.dev ofrece estos dos a OpenAI; `gpt-4.1-nano` ya no está (S2). */
const GPT56_LUNA = {
  id: "gpt-5.6-luna",
  name: "GPT-5.6 Luna",
  provider: "openai",
  reasoning: true,
  type: "chat",
  contextWindow: 400000,
  thinkingLevelMap: { off: "none", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
};
const GPT54_MINI = {
  id: "gpt-5.4-mini",
  name: "GPT-5.4 mini",
  provider: "openai",
  reasoning: true,
  type: "chat",
  contextWindow: 400000,
  thinkingLevelMap: { off: "none", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
};
/** No razonador en pi.dev (`reasoning: false`, sin mapa): tiene que seguir sin effort. */
const GPT41 = {
  id: "gpt-4.1",
  name: "GPT-4.1",
  provider: "openai",
  reasoning: false,
  type: "chat",
  contextWindow: 1047576,
};

/** `http` falso: sólo responde al catálogo de OpenAI en pi.dev. */
const catalogoVivo: CatalogHttp = async (url) =>
  url === `${PI_DEV_MODELS_BASE}/openai?types=chat`
    ? { status: 200, etag: '"v1"', body: [GPT56_LUNA, GPT54_MINI, GPT41] }
    : { status: 404, etag: null, body: null };

/** Mensaje exacto del rechazo: quien lo lea tiene que saber qué hacer a continuación. */
const RECHAZO = 'El modelo "gpt-4.1-nano" no está en el catálogo vivo. Elige otro de GET /api/models.';

/** Lo que devolvía la tabla estática para gpt-5.4-mini antes de este cambio. */
const MODEL_CAP_STATIC_GPT54_MINI = {
  efforts: ["none", "low", "medium", "high", "xhigh"],
  defaultEffort: "none",
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "u1", email: "op@estudio.com", role: "admin" } as never;
    next();
  });
  app.use("/api/agents", agentsRouter);
  app.use(errorHandler);
  return app;
}

function request(
  app: express.Express,
  method: string,
  path: string,
  payload?: unknown
): Promise<{ status: number; body: any }> {
  const raw = payload === undefined ? undefined : JSON.stringify(payload);
  const headers: Record<string, string> = raw
    ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(raw)) }
    : {};
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
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
      if (raw) req.write(raw);
      req.end();
    });
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetModelCatalog();
  await refreshModelCatalog({ http: catalogoVivo, env: {} });
  asMock(createAgent).mockResolvedValue({ id: "a1", model: "gpt-5.6-luna" });
  asMock(updateAgent).mockImplementation(async (id: string, data: unknown) => ({ id, ...(data as object) }));
  asMock(prisma.conversation.findFirst).mockResolvedValue(null);
  asMock(prisma.conversation.groupBy).mockResolvedValue([]);
});

describe("S6 — elegir un modelo que ya no está en el catálogo vivo se rechaza", () => {
  it("POST /api/agents ⇒ 400 con el mensaje exacto y sin crear el agente", async () => {
    const res = await request(buildApp(), "POST", "/api/agents", {
      name: "Agente",
      sector: "salud",
      systemPrompt: "Eres un asistente.",
      model: "gpt-4.1-nano",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(RECHAZO);
    expect(res.body.code).toBe("MODEL_NOT_IN_CATALOG");
    expect(createAgent).not.toHaveBeenCalled();
  });

  it("PATCH /api/agents/:id ⇒ 400 y no escribe nada", async () => {
    const res = await request(buildApp(), "PATCH", "/api/agents/a1", { model: "gpt-4.1-nano" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(RECHAZO);
    expect(res.body.code).toBe("MODEL_NOT_IN_CATALOG");
    expect(updateAgent).not.toHaveBeenCalled();
  });

  it("un modelo del catálogo vivo se sigue aceptando (el rechazo no se lleva por delante el alta)", async () => {
    const res = await request(buildApp(), "POST", "/api/agents", {
      name: "Agente",
      sector: "salud",
      systemPrompt: "Eres un asistente.",
      model: "gpt-5.6-luna",
    });

    expect(res.status).toBe(201);
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.6-luna" }));
  });
});

describe("S6 — un agente que ya tiene el modelo retirado no se toca", () => {
  it("el listado devuelve el agente con su modelo tal cual (sin reescribir filas por detrás)", async () => {
    asMock(prisma.agent.findMany).mockResolvedValue([
      {
        id: "a1",
        name: "Agente viejo",
        status: "draft",
        publishedAt: null,
        tenantId: null,
        systemPrompt: "Eres útil",
        channel: "widget",
        widgetInstalledAt: null,
        model: "gpt-4.1-nano",
        channelConnections: [],
        tenant: null,
        integrations: [],
        _count: { knowledge: 0, conversations: 0, leads: 0, automations: 0 },
      },
    ]);

    const agents = await listAgents();

    expect(agents[0].model).toBe("gpt-4.1-nano");
    // Y no hay ninguna escritura: el catálogo retira modelos del SELECTOR, no de la base.
    expect(prisma.agent.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.agent).not.toHaveProperty("update");
  });
});

describe("S6 — capsFor/resolveEffort: catálogo primero, tabla estática de respaldo", () => {
  it("con catálogo vivo, los efforts vienen de thinkingLevelMap y la ruta no depende del catálogo", () => {
    // S5: la ruta la decide el proveedor, no un campo por modelo. `capsFor` sólo devuelve efforts.
    expect(capsFor("gpt-5.6-luna")).toEqual({
      efforts: ["none", "low", "medium", "high", "xhigh"],
      defaultEffort: "low",
    });
    expect(usesResponsesApi("gpt-5.6-luna")).toBe(true);
    expect(resolveEffort("gpt-5.6-luna")).toBe("low");
    expect(resolveEffort("gpt-5.6-luna", "high")).toBe("high");
    // Un nivel que el modelo no acepta cae a su default, como antes.
    expect(resolveEffort("gpt-5.6-luna", "max")).toBe("low");
  });

  it("un modelo del catálogo vivo sin thinkingLevelMap sigue sin mandar effort", () => {
    expect(capsFor("gpt-4.1")).toEqual({ efforts: [], defaultEffort: null });
    expect(resolveEffort("gpt-4.1", "high")).toBeNull();
  });

  it("sin catálogo vivo, se usa la tabla estática de siempre", () => {
    resetModelCatalog();

    expect(capsFor("gpt-5.4-mini")).toEqual(MODEL_CAP_STATIC_GPT54_MINI);
    expect(resolveEffort("gpt-5.4-mini")).toBe("none");
    expect(usesResponsesApi("gpt-5.6-luna")).toBe(true);
  });

  it("Claude sigue SIN effort aunque pi.dev le declare niveles (su capa OpenAI-compat los ignora)", async () => {
    resetModelCatalog();
    const http: CatalogHttp = async (url) =>
      url === `${PI_DEV_MODELS_BASE}/anthropic?types=chat`
        ? {
            status: 200,
            etag: '"v1"',
            body: [
              {
                id: "claude-opus-5",
                name: "Claude Opus 5",
                provider: "anthropic",
                reasoning: true,
                type: "chat",
                // Lo que pi.dev declara HOY para claude-opus-5 (su API nativa).
                thinkingLevelMap: { xhigh: "xhigh", max: "max" },
              },
            ],
          }
        : { status: 404, etag: null, body: null };
    await refreshModelCatalog({ http, env: {} });

    expect(modelSupportsEffort("claude-opus-5")).toBe(false);
    expect(resolveEffort("claude-opus-5", "xhigh")).toBeNull();

    // Y la consecuencia que importa: Claude conserva su `temperature` y no recibe un
    // `reasoning_effort` que su capa OpenAI-compatible ignoraría en silencio.
    const body: any = governChatBody(
      { model: "claude-opus-5", messages: [], temperature: 0.2, reasoning_effort: "xhigh" },
      "low"
    );
    expect(body.temperature).toBe(0.2);
    expect(body).not.toHaveProperty("reasoning_effort");
  });
});
