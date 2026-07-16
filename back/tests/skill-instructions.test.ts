/**
 * aa-agent-skills-install-execute — Nivel 1, Fase 1 (motor de instrucciones).
 * Cubre:
 *  - T1.1: schema `Skill.instructions`/`instructionsUpdatedAt` + migración ADITIVA.
 *  - T1.2: `SKILL_TOOL` (usar_skill) existe con el input schema documentado.
 *  - T1.3: `buildAgentTools` monta usar_skill SOLO con ≥1 skill instalada;
 *          `buildSystemPrompt` añade índice 1-línea/skill + guía + framing
 *          anti-inyección. Regresión cero: 0 skills → salida idéntica.
 *  - T1.4: handler `usar_skill` — instalada/no-instalada/truncado/framing/fallback.
 *  - T1.5: PATCH /api/skills/:id/instructions (validación, cap 32 KB, clear, 404).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Mocks (patrón de agent-backend-tools.test.ts) ───────────────────────────
vi.mock("@/lib/db", () => ({
  prisma: {
    agentSkill: { findFirst: vi.fn() },
    skill: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/embeddings", () => ({ searchKnowledge: vi.fn() }));
vi.mock("@/lib/agent/order-status", () => ({ fetchOrderStatus: vi.fn() }));
vi.mock("@/lib/agent-backend/managed-db", () => ({ resolveAgentBackendAdapter: vi.fn() }));
vi.mock("@/lib/openai", () => ({ openai: {}, getClientForAgent: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ processNewLead: vi.fn() }));
vi.mock("@/lib/token-metering", () => ({ deductTokens: vi.fn() }));

import { prisma } from "@/lib/db";
import { executeTool } from "@/lib/agent/executor";
import { buildAgentTools, buildSystemPrompt } from "@/lib/agent/engine";
import { SKILL_TOOL } from "@/lib/agent/tools";
import { skillsRouter } from "@/routes/skills";
import { HttpError } from "@/lib/http";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SCHEMA = readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf-8");
const MIGRATION = readFileSync(
  path.join(__dirname, "..", "prisma", "migrations", "20260716140000_skill_instructions", "migration.sql"),
  "utf-8"
);

// ── T1.1: schema + migración ────────────────────────────────────────────────
describe("schema Skill.instructions (T1.1)", () => {
  const model = SCHEMA.match(/model Skill \{[\s\S]*?\n\}/)?.[0];

  it("añade instructions String? e instructionsUpdatedAt DateTime? con @map castellano", () => {
    expect(model).toBeTruthy();
    expect(model).toMatch(/instructions\s+String\?\s+@map\("instrucciones"\)/);
    expect(model).toMatch(/instructionsUpdatedAt\s+DateTime\?\s+@map\("instrucciones_actualizado_en"\)/);
  });
});

describe("migración 20260716140000_skill_instructions (T1.1)", () => {
  const sql = MIGRATION.replace(/^\s*--.*$/gm, "");

  it("es ADITIVA: solo ADD COLUMN sobre skill, sin DROP/DELETE/UPDATE/TRUNCATE", () => {
    expect(sql).toMatch(/ALTER TABLE "skill" ADD COLUMN "instrucciones" TEXT/);
    expect(sql).toMatch(/ALTER TABLE "skill" ADD COLUMN "instrucciones_actualizado_en" TIMESTAMP\(3\)/);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/^\s*UPDATE\b/im);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    // El único ALTER permitido es sobre la tabla existente `skill` (ADD COLUMN aditivo).
    const alters = sql.match(/ALTER TABLE\s+"([^"]+)"/gi) ?? [];
    for (const a of alters) expect(a).toContain('"skill"');
  });
});

// ── T1.2: SKILL_TOOL ────────────────────────────────────────────────────────
describe("SKILL_TOOL (T1.2)", () => {
  it("se llama usar_skill y toma skillName requerido", () => {
    expect(SKILL_TOOL.name).toBe("usar_skill");
    expect(SKILL_TOOL.input_schema.properties).toHaveProperty("skillName");
    expect(SKILL_TOOL.input_schema.required).toContain("skillName");
  });

  it("la descripción instruye invocación contextual y marca contenido no confiable", () => {
    expect(SKILL_TOOL.description.toLowerCase()).toMatch(/instalada/);
    expect(SKILL_TOOL.description.toLowerCase()).toMatch(/no confiable|reglas de sistema/);
  });
});

// ── T1.3: gating de tool + índice en el prompt + regresión cero ─────────────
describe("buildAgentTools — gating de usar_skill (T1.3)", () => {
  it("0 skills instaladas → NO monta usar_skill (regresión cero, byte-idéntico)", () => {
    const names = buildAgentTools([], [], null).map((t) => t.function.name);
    expect(names).not.toContain("usar_skill");
  });

  it("≥1 skill instalada → monta usar_skill", () => {
    const names = buildAgentTools([], [], null, null, 1).map((t) => t.function.name);
    expect(names).toContain("usar_skill");
  });

  it("regresión cero: pasar 0 explícito equivale al default (mismas tools)", () => {
    const a = buildAgentTools([], [], null, null, 0).map((t) => t.function.name);
    const b = buildAgentTools([], [], null).map((t) => t.function.name);
    expect(a).toEqual(b);
  });
});

describe("buildSystemPrompt — índice de skills (T1.3)", () => {
  const agent = {
    name: "Bot",
    systemPrompt: "Eres un asistente.",
    skills: [
      {
        skillId: "s1",
        skill: {
          name: "Guía de devoluciones",
          description: "Cómo gestionar devoluciones",
          use: "",
          toolsProvider: null,
        },
      },
    ],
  };
  const caps = {
    executableProviders: [] as string[],
    missingConnections: [] as any[],
    informationalSkills: [{ skillId: "s1", name: "Guía de devoluciones" }],
  };

  it("añade 1 línea nombre+descripción por skill + guía usar_skill + framing anti-inyección", () => {
    const s = buildSystemPrompt(
      agent as any,
      caps as any,
      [{ id: "s1", name: "Guía de devoluciones", use: "" }],
      false,
      null
    );
    expect(s).toContain("- Guía de devoluciones: Cómo gestionar devoluciones");
    expect(s).toContain("usar_skill");
    // Framing anti-inyección explícito: contenido no confiable, reglas prevalecen.
    expect(s.toLowerCase()).toMatch(/no confiable/);
    expect(s.toLowerCase()).toMatch(/prevalec/);
  });

  it("regresión cero (T2.3): 0 skills → sin índice ni usar_skill en el prompt", () => {
    const s = buildSystemPrompt(
      { name: "Bot", systemPrompt: "Eres un asistente.", skills: [] } as any,
      { executableProviders: [], missingConnections: [], informationalSkills: [] } as any,
      [],
      false,
      null
    );
    expect(s).not.toContain("usar_skill");
    expect(s).not.toContain("Skills instaladas");
  });
});

// ── T1.4: handler usar_skill ────────────────────────────────────────────────
describe("usar_skill handler (T1.4)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skill instalada con instructions → cuerpo con framing no confiable, curated=true", async () => {
    asMock(prisma.agentSkill.findFirst).mockResolvedValue({
      skill: {
        name: "Guía de devoluciones",
        description: "desc",
        use: "SOPORTE",
        instructions: "Paso 1: pedir número de pedido.",
      },
    });

    const res = (await executeTool("ag-1", "usar_skill", { skillName: "Guía de devoluciones" })) as any;

    expect(res.name).toBe("Guía de devoluciones");
    expect(res.curated).toBe(true);
    expect(res.truncated).toBe(false);
    expect(res.instructions).toContain("Paso 1: pedir número de pedido.");
    expect(res.instructions.toLowerCase()).toMatch(/no confiable/);
    // La verificación se hace por AgentSkill del agente (scoping).
    expect(asMock(prisma.agentSkill.findFirst).mock.calls[0][0]).toMatchObject({
      where: { agentId: "ag-1", skill: { name: "Guía de devoluciones" } },
    });
  });

  it("skill NO instalada en el agente → error honesto, NUNCA contenido", async () => {
    asMock(prisma.agentSkill.findFirst).mockResolvedValue(null);

    const res = (await executeTool("ag-1", "usar_skill", { skillName: "Fantasma" })) as any;

    expect(res.error).toMatch(/no está instalada/i);
    expect(res.instructions).toBeUndefined();
  });

  it("instructions null → fallback a description/use, curated=false", async () => {
    asMock(prisma.agentSkill.findFirst).mockResolvedValue({
      skill: { name: "Skill baseline", description: "Solo descripción", use: "GENERAL", instructions: null },
    });

    const res = (await executeTool("ag-1", "usar_skill", { skillName: "Skill baseline" })) as any;

    expect(res.curated).toBe(false);
    expect(res.instructions).toContain("Solo descripción");
  });

  it("instructions muy largas → se truncan a 8000 chars con truncated=true", async () => {
    asMock(prisma.agentSkill.findFirst).mockResolvedValue({
      skill: { name: "Larga", description: "d", use: "", instructions: "x".repeat(9000) },
    });

    const res = (await executeTool("ag-1", "usar_skill", { skillName: "Larga" })) as any;

    expect(res.truncated).toBe(true);
    expect(res.instructions).toContain("x".repeat(8000));
    expect(res.instructions).not.toContain("x".repeat(8001));
  });

  it("skillName vacío → error, sin tocar la BD", async () => {
    const res = (await executeTool("ag-1", "usar_skill", { skillName: "  " })) as any;
    expect(res.error).toBeTruthy();
    expect(asMock(prisma.agentSkill.findFirst)).not.toHaveBeenCalled();
  });
});

// ── T1.5: PATCH /api/skills/:id/instructions ────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json({ limit: "40mb" }));
  app.use("/api/skills", skillsRouter);
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

describe("PATCH /api/skills/:id/instructions (T1.5)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("set: guarda instructions y sella instructionsUpdatedAt", async () => {
    asMock(prisma.skill.findUnique).mockResolvedValue({ id: "sk-1", name: "X" });
    asMock(prisma.skill.update).mockImplementation(async ({ data }: any) => ({ id: "sk-1", ...data }));

    const res = await rawRequest(buildApp(), "PATCH", "/api/skills/sk-1/instructions", {
      instructions: "Nuevo cuerpo curado.",
    });

    expect(res.status).toBe(200);
    const arg = asMock(prisma.skill.update).mock.calls[0][0];
    expect(arg.data.instructions).toBe("Nuevo cuerpo curado.");
    expect(arg.data.instructionsUpdatedAt).not.toBeNull();
  });

  it("clear: instructions null → instructionsUpdatedAt null", async () => {
    asMock(prisma.skill.findUnique).mockResolvedValue({ id: "sk-1", name: "X" });
    asMock(prisma.skill.update).mockImplementation(async ({ data }: any) => ({ id: "sk-1", ...data }));

    const res = await rawRequest(buildApp(), "PATCH", "/api/skills/sk-1/instructions", {
      instructions: null,
    });

    expect(res.status).toBe(200);
    const arg = asMock(prisma.skill.update).mock.calls[0][0];
    expect(arg.data.instructions).toBeNull();
    expect(arg.data.instructionsUpdatedAt).toBeNull();
  });

  it("cap 32 KB: cuerpo > 32768 chars → 400 sin tocar la BD", async () => {
    const res = await rawRequest(buildApp(), "PATCH", "/api/skills/sk-1/instructions", {
      instructions: "a".repeat(32 * 1024 + 1),
    });

    expect(res.status).toBe(400);
    expect(asMock(prisma.skill.findUnique)).not.toHaveBeenCalled();
  });

  it("tipo inválido (number) → 400", async () => {
    const res = await rawRequest(buildApp(), "PATCH", "/api/skills/sk-1/instructions", {
      instructions: 123,
    });
    expect(res.status).toBe(400);
  });

  it("skill inexistente → 404 (gate)", async () => {
    asMock(prisma.skill.findUnique).mockResolvedValue(null);
    const res = await rawRequest(buildApp(), "PATCH", "/api/skills/nope/instructions", {
      instructions: "x",
    });
    expect(res.status).toBe(404);
  });
});
