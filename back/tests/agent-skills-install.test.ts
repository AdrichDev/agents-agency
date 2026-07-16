/**
 * aa-agent-skills-install-execute — Nivel 1, Fase 2 (endpoint de instalación).
 * Cubre:
 *  - T2.1 (servicio): setAgentSkills — set/replace/vaciar el conjunto curado,
 *    404 agente, 400 ids inválidos (con lista), 400 cap MAX_INSTALLED_SKILLS,
 *    dedupe, transaccionalidad (deleteMany + createMany) y shape de skillStatus
 *    por TIPO de ejecución.
 *  - T2.2 (ruta): PUT /api/agents/:id/skills — validación zod del body, 200 con
 *    skillStatus (service real + BD mockeada).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Mocks (patrón de agents-create-backend.test.ts) ─────────────────────────
vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn() },
    skill: { findMany: vi.fn() },
    agentSkill: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  },
}));
vi.mock("@/lib/codes", () => ({
  nextClientCode: vi.fn(),
  nextQuoteNumber: vi.fn(),
  withCodeRetry: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock("@/lib/scraper/web", () => ({ ingestWebsite: vi.fn() }));
vi.mock("@/lib/n8n/client", () => ({ isConfigured: vi.fn(() => false) }));
vi.mock("@/lib/storage", () => ({
  avatarAction: vi.fn(() => ({ kind: "noop" })),
  uploadImageDataUrl: vi.fn(),
  deletePublicAsset: vi.fn(),
  deleteKbFolder: vi.fn(),
}));
vi.mock("@/lib/openclaw/provision", () => ({ syncAgentProvisioning: vi.fn() }));
vi.mock("@/lib/agent-backend/provisioning", () => ({ provisionManagedDbBackend: vi.fn() }));

import { prisma } from "@/lib/db";
import { setAgentSkills, MAX_INSTALLED_SKILLS } from "@/lib/agent/service";
import { agentsRouter, setAgentSkillsSchema } from "@/routes/agents";
import { HttpError } from "@/lib/http";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** Captura el HttpError lanzado por una promesa rechazada. */
async function catchHttp(p: Promise<unknown>): Promise<HttpError> {
  try {
    await p;
  } catch (e) {
    return e as HttpError;
  }
  throw new Error("Se esperaba un HttpError, pero la promesa resolvió.");
}

const AGENT = {
  id: "ag-1",
  ecommerceConfig: {},
  integrations: [{ provider: "google" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.agent.findUnique).mockResolvedValue(AGENT);
  asMock(prisma.agentSkill.deleteMany).mockResolvedValue({ count: 0 });
  asMock(prisma.agentSkill.createMany).mockResolvedValue({ count: 0 });
  asMock(prisma.agentSkill.findMany).mockResolvedValue([]);
});

// ── T2.1: servicio ──────────────────────────────────────────────────────────
describe("setAgentSkills (T2.1)", () => {
  it("set/replace: valida existencia, reemplaza transaccionalmente y devuelve skillStatus", async () => {
    asMock(prisma.skill.findMany).mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    asMock(prisma.agentSkill.findMany).mockResolvedValue([
      { skillId: "s1", skill: { name: "Agenda", use: "CALENDARIO", toolsProvider: "calendar" } },
      { skillId: "s2", skill: { name: "Recordatorios", use: "GENERAL", toolsProvider: null } },
    ]);

    const res = await setAgentSkills("ag-1", ["s1", "s2"]);

    // Reemplazo declarativo transaccional.
    expect(prisma.agentSkill.deleteMany).toHaveBeenCalledWith({ where: { agentId: "ag-1" } });
    expect(asMock(prisma.agentSkill.createMany).mock.calls[0][0]).toEqual({
      data: [
        { agentId: "ag-1", skillId: "s1" },
        { agentId: "ag-1", skillId: "s2" },
      ],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // skillStatus por TIPO de ejecución (google conectado → calendar executable).
    expect(res.skillStatus).toEqual([
      { skillId: "s1", name: "Agenda", state: "executable" },
      { skillId: "s2", name: "Recordatorios", state: "informational" },
    ]);
  });

  it("vaciar ([]): no valida skills, crea 0 filas y devuelve skillStatus vacío", async () => {
    const res = await setAgentSkills("ag-1", []);

    expect(prisma.skill.findMany).not.toHaveBeenCalled();
    expect(prisma.agentSkill.deleteMany).toHaveBeenCalledWith({ where: { agentId: "ag-1" } });
    expect(asMock(prisma.agentSkill.createMany).mock.calls[0][0]).toEqual({ data: [] });
    expect(res.skillStatus).toEqual([]);
  });

  it("dedupe: ids repetidos → una sola fila por skill", async () => {
    asMock(prisma.skill.findMany).mockResolvedValue([{ id: "s1" }]);
    asMock(prisma.agentSkill.findMany).mockResolvedValue([
      { skillId: "s1", skill: { name: "Agenda", use: "CALENDARIO", toolsProvider: "calendar" } },
    ]);

    await setAgentSkills("ag-1", ["s1", "s1", "s1"]);

    expect(asMock(prisma.skill.findMany).mock.calls[0][0].where.id.in).toEqual(["s1"]);
    expect(asMock(prisma.agentSkill.createMany).mock.calls[0][0]).toEqual({
      data: [{ agentId: "ag-1", skillId: "s1" }],
    });
  });

  it("404 si el agente no existe (nada se persiste)", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(null);

    const err = await catchHttp(setAgentSkills("ag-x", ["s1"]));
    expect(err.status).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("400 con la lista de ids inválidos cuando algún skillId no existe", async () => {
    asMock(prisma.skill.findMany).mockResolvedValue([{ id: "s1" }]); // s2/s3 no existen

    const err = await catchHttp(setAgentSkills("ag-1", ["s1", "s2", "s3"]));
    expect(err.status).toBe(400);
    expect((err.details as any).invalid).toEqual(["s2", "s3"]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it(`400 al superar MAX_INSTALLED_SKILLS (${MAX_INSTALLED_SKILLS})`, async () => {
    const ids = Array.from({ length: MAX_INSTALLED_SKILLS + 1 }, (_, i) => `s${i}`);

    const err = await catchHttp(setAgentSkills("ag-1", ids));
    expect(err.status).toBe(400);
    // El cap se evalúa antes de validar existencia (no consulta skills).
    expect(prisma.skill.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("skillStatus refleja requires_connection cuando falta la integración física", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue({ ...AGENT, integrations: [] });
    asMock(prisma.skill.findMany).mockResolvedValue([{ id: "s1" }]);
    asMock(prisma.agentSkill.findMany).mockResolvedValue([
      { skillId: "s1", skill: { name: "Agenda", use: "CALENDARIO", toolsProvider: "calendar" } },
    ]);

    const res = await setAgentSkills("ag-1", ["s1"]);
    expect(res.skillStatus).toEqual([
      { skillId: "s1", name: "Agenda", state: "requires_connection", provider: "google" },
    ]);
  });
});

// ── T2.2: ruta ──────────────────────────────────────────────────────────────
describe("setAgentSkillsSchema (T2.2)", () => {
  it("rechaza body sin skillIds, no-array o con elementos vacíos", () => {
    expect(setAgentSkillsSchema.safeParse({}).success).toBe(false);
    expect(setAgentSkillsSchema.safeParse({ skillIds: "s1" }).success).toBe(false);
    expect(setAgentSkillsSchema.safeParse({ skillIds: [""] }).success).toBe(false);
  });

  it("acepta array de ids (incluye vacío para desinstalar todo)", () => {
    expect(setAgentSkillsSchema.safeParse({ skillIds: [] }).success).toBe(true);
    expect(setAgentSkillsSchema.safeParse({ skillIds: ["s1", "s2"] }).success).toBe(true);
  });
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message, details: err.details });
  });
  return app;
}

function rawRequest(
  app: express.Express,
  method: string,
  path: string,
  payload?: unknown
): Promise<{ status: number; body: any }> {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const headers: Record<string, string> = body
    ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) }
    : {};
  return new Promise((resolve, reject) => {
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

describe("PUT /api/agents/:id/skills (T2.2)", () => {
  it("200 con skillStatus para un body válido (service real + BD mockeada)", async () => {
    asMock(prisma.skill.findMany).mockResolvedValue([{ id: "s1" }]);
    asMock(prisma.agentSkill.findMany).mockResolvedValue([
      { skillId: "s1", skill: { name: "Agenda", use: "CALENDARIO", toolsProvider: "calendar" } },
    ]);

    const res = await rawRequest(buildApp(), "PUT", "/api/agents/ag-1/skills", { skillIds: ["s1"] });

    expect(res.status).toBe(200);
    expect(res.body.skillStatus).toEqual([{ skillId: "s1", name: "Agenda", state: "executable" }]);
  });

  it("400 si el body no pasa el schema zod (skillIds ausente)", async () => {
    const res = await rawRequest(buildApp(), "PUT", "/api/agents/ag-1/skills", {});
    expect(res.status).toBe(400);
  });
});
