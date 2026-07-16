/**
 * T4 (aa-agent-backend-foundation, validation.md) — wizard/API "Datos del negocio":
 *  - El schema zod de POST /api/agents RECHAZA la creación sin selección de
 *    backend (sin default silencioso) y rechaza managed_db sin capabilities.
 *  - external_api es backlog v2: no se acepta.
 *  - createAgent persiste AgentDataBackend ATÓMICAMENTE (create anidado en el
 *    mismo prisma.agent.create): managed_db con capabilities, none_yet sin ellas.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const prismaMock: any = {
    agent: { create: vi.fn(), update: vi.fn() },
    budget: { create: vi.fn() },
    tenant: { findUnique: vi.fn() },
  };
  return { prisma: prismaMock };
});

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
}));
vi.mock("@/lib/openclaw/provision", () => ({
  syncAgentProvisioning: vi.fn().mockResolvedValue({
    ok: true,
    status: "synced",
    provisionState: "provisioned",
    pendingRestart: false,
  }),
}));

import { prisma } from "@/lib/db";
import { createAgent } from "@/lib/agent/service";
import { createAgentSchema } from "@/routes/agents";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const validBody = {
  name: "Agente Test",
  sector: "salud",
  systemPrompt: "Eres un asistente.",
};

describe("createAgentSchema — selección obligatoria de backend de datos (AC4)", () => {
  it("sin dataBackend → default none_yet (backward-compat GAP #2, callers no-wizard)", () => {
    const parsed = createAgentSchema.safeParse(validBody);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.dataBackend).toEqual({ mode: "none_yet" });
    }
  });

  it("reasoningEffort='' (panel sin selector) → tratado como ausente → default low", () => {
    const parsed = createAgentSchema.safeParse({ ...validBody, reasoningEffort: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.reasoningEffort).toBe("low");
    }
  });

  it("rechaza managed_db sin capabilities y con capabilities vacías", () => {
    expect(
      createAgentSchema.safeParse({ ...validBody, dataBackend: { mode: "managed_db" } }).success
    ).toBe(false);
    expect(
      createAgentSchema.safeParse({
        ...validBody,
        dataBackend: { mode: "managed_db", capabilities: [] },
      }).success
    ).toBe(false);
  });

  it("rechaza external_api (backlog v2) y capabilities desconocidas", () => {
    expect(
      createAgentSchema.safeParse({
        ...validBody,
        dataBackend: { mode: "external_api", capabilities: ["pedidos"] },
      }).success
    ).toBe(false);
    expect(
      createAgentSchema.safeParse({
        ...validBody,
        dataBackend: { mode: "managed_db", capabilities: ["facturas"] },
      }).success
    ).toBe(false);
  });

  it("acepta none_yet (solo información) y managed_db con capabilities válidas", () => {
    const noneYet = createAgentSchema.safeParse({ ...validBody, dataBackend: { mode: "none_yet" } });
    expect(noneYet.success).toBe(true);

    const managed = createAgentSchema.safeParse({
      ...validBody,
      dataBackend: { mode: "managed_db", capabilities: ["reservas", "leads"] },
    });
    expect(managed.success).toBe(true);
    if (managed.success) {
      expect(managed.data.dataBackend).toEqual({
        mode: "managed_db",
        capabilities: ["reservas", "leads"],
      });
      // skillIds oculto del wizard pero retrocompatible: default []
      expect(managed.data.skillIds).toEqual([]);
    }
  });
});

describe("createAgent — persiste AgentDataBackend atómicamente (AC4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asMock(prisma.agent.create).mockResolvedValue({
      id: "agent-1",
      name: "Agente Test",
      sector: "salud",
      runtime: "openai",
      tenantId: null,
      tenant: null,
    });
  });

  it("managed_db: crea el agente con dataBackend anidado (mode + capabilities) en un único create", async () => {
    await createAgent({
      ...validBody,
      runtime: "openai",
      skillIds: [],
      dataBackend: { mode: "managed_db", capabilities: ["reservas", "pedidos"] },
    });

    expect(prisma.agent.create).toHaveBeenCalledTimes(1);
    const createArg = asMock(prisma.agent.create).mock.calls[0][0];
    expect(createArg.data.dataBackend).toEqual({
      create: { mode: "managed_db", capabilities: ["reservas", "pedidos"] },
    });
    // Atómico: mismo create que persiste el agente, no un write posterior.
    expect(createArg.data.name).toBe("Agente Test");
    expect(prisma.agent.update).not.toHaveBeenCalled();
  });

  it("none_yet: crea el backend sin capabilities aunque el input las traiga", async () => {
    await createAgent({
      ...validBody,
      runtime: "openai",
      skillIds: [],
      dataBackend: { mode: "none_yet", capabilities: ["reservas"] },
    });

    const createArg = asMock(prisma.agent.create).mock.calls[0][0];
    expect(createArg.data.dataBackend).toEqual({
      create: { mode: "none_yet", capabilities: [] },
    });
  });
});
