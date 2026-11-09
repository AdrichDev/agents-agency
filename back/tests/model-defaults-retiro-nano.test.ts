/**
 * S5 (responses-api-migration, T2) — los valores por defecto que crean agentes ya no son un modelo
 * retirado.
 *
 * `gpt-4.1-nano` devuelve 404 desde que OpenAI lo retiró. Un default no es cosmético: es el modelo
 * con el que nace cada agente nuevo sin que nadie elija nada, así que dejarlo apuntando a un modelo
 * muerto significa que el alta crea agentes caídos. Se prueba por la puerta de entrada real —el
 * schema zod del alta y la ruta de configuración— y no leyendo la constante.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => {
  const prismaMock: any = {
    agent: { create: vi.fn(), update: vi.fn() },
    budget: { create: vi.fn() },
    tenant: { findUnique: vi.fn() },
    systemConfig: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  };
  return { prisma: prismaMock };
});
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
  getClientForAgent: vi.fn(),
  DEFAULT_MODEL: "gpt-5.6-luna",
  STRONG_MODEL: "gpt-5.4",
  refreshModelConfig: vi.fn(),
}));
vi.mock("@/lib/codes", () => ({
  nextClientCode: vi.fn().mockResolvedValue("cli-99"),
  nextQuoteNumber: vi.fn().mockResolvedValue("PRE-99"),
  withCodeRetry: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock("@/lib/scraper/web", () => ({ ingestWebsite: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/n8n/client", () => ({ isConfigured: vi.fn(() => false) }));
vi.mock("@/lib/storage", () => ({
  avatarAction: vi.fn(() => ({ kind: "noop" })),
  uploadImageDataUrl: vi.fn(),
  deletePublicAsset: vi.fn(),
  deleteKbFolder: vi.fn(),
}));
vi.mock("@/lib/openclaw/provision", () => ({
  syncAgentProvisioning: vi.fn().mockResolvedValue({
    ok: true,
    status: "synced",
    provisionState: "provisioned",
    pendingRestart: false,
  }),
}));
vi.mock("@/lib/integrations/oauth", () => ({
  encryptToken: vi.fn(() => "cifrado"),
  decryptToken: vi.fn(() => "secreto"),
  redirectUri: vi.fn(() => "https://app.example/api/integrations/google/callback"),
}));

import { prisma } from "@/lib/db";
import { createAgentSchema } from "@/routes/agents";
import { configRouter } from "@/routes/config";
import { HttpError } from "@/lib/http";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "u1", email: "op@estudio.com", role: "admin" } as never;
    next();
  });
  app.use("/api/config", configRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message });
  });
  return app;
}

function post(app: express.Express, path: string, payload: unknown) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
  };
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        { host: "127.0.0.1", port, method: "POST", path, headers },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null });
          });
        }
      );
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      req.end(body);
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.systemConfig.upsert).mockImplementation(async ({ create }: any) => ({
    id: "default",
    ...create,
  }));
});

describe("alta de agente — el default del modelo es gpt-5.6-luna", () => {
  it("sin `model` en el cuerpo, el schema del alta resuelve gpt-5.6-luna", () => {
    const parsed = createAgentSchema.safeParse({
      name: "Agente Nuevo",
      sector: "salud",
      systemPrompt: "Eres un asistente.",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.model).toBe("gpt-5.6-luna");
  });

  it("un `model` explícito se sigue respetando (el default sólo rellena el hueco)", () => {
    const parsed = createAgentSchema.safeParse({
      name: "Agente Nuevo",
      sector: "salud",
      systemPrompt: "Eres un asistente.",
      model: "gpt-5.4-mini",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.model).toBe("gpt-5.4-mini");
  });
});

describe("configuración global — el modelo por defecto es gpt-5.6-luna", () => {
  it("POST /api/config sin defaultAgentModel crea la fila con gpt-5.6-luna", async () => {
    const res = await post(buildApp(), "/api/config", { theme: "dark" });

    expect(res.status).toBe(200);
    const data = asMock(prisma.systemConfig.upsert).mock.calls[0][0].create;
    expect(data.defaultAgentModel).toBe("gpt-5.6-luna");
  });

  it("si el admin manda un defaultAgentModel explícito, se guarda el suyo", async () => {
    const res = await post(buildApp(), "/api/config", {
      theme: "dark",
      defaultAgentModel: "gpt-5.4",
    });

    expect(res.status).toBe(200);
    const data = asMock(prisma.systemConfig.upsert).mock.calls[0][0];
    expect(data.update.defaultAgentModel).toBe("gpt-5.4");
    expect(data.create.defaultAgentModel).toBe("gpt-5.4");
  });
});
