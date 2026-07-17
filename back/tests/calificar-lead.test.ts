/**
 * T2.2 — aa-agent-external-crm-and-lead-qualification F2 (design.md §C.2/§C.3).
 * Cubre el handler `calificar_lead` del executor:
 *  - actualiza `qualification`/`qualificationReason` por `conversationId`
 *    (upsert, crea Lead mínimo si no existía);
 *  - `hot` dispara `dispatchNotification("nuevo_lead", {..., qualification:"hot"})`
 *    (spy) — best-effort, nunca rompe el flujo aunque el dispatcher falle;
 *  - `warm`/`cold` NO notifican;
 *  - gate por capability `leads` (managed_db y external_api indistintamente);
 *  - input inválido → error claro, sin tocar Prisma.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (patrón notify-dispatcher.test.ts) ────────────────────────────────
vi.mock("@/lib/db", () => ({
  prisma: {
    agentDataBackend: { findUnique: vi.fn() },
    lead: { upsert: vi.fn() },
  },
}));
vi.mock("@/lib/agent-backend/managed-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-backend/managed-db")>();
  return { ...actual, resolveAgentBackendAdapter: vi.fn() };
});
vi.mock("@/lib/agent-backend/notify-dispatcher", () => ({ dispatchNotification: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ searchKnowledge: vi.fn() }));
vi.mock("@/lib/openai", () => ({ openai: {}, getClientForAgent: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ processNewLead: vi.fn() }));
vi.mock("@/lib/token-metering", () => ({ deductTokens: vi.fn() }));
vi.mock("@/lib/agent/order-status", () => ({ fetchOrderStatus: vi.fn() }));
vi.mock("@/lib/agent/handoff", () => ({
  isWithinBusinessHours: vi.fn(() => true),
  mergeConversationMetadata: vi.fn(async () => {}),
  getConversationMetadata: vi.fn(async () => ({})),
  buildConversationSummary: vi.fn(async () => "resumen"),
}));

import { prisma } from "@/lib/db";
import { dispatchNotification } from "@/lib/agent-backend/notify-dispatcher";
import { getConversationMetadata } from "@/lib/agent/handoff";
import { executeTool } from "@/lib/agent/executor";

const mockBackend = prisma.agentDataBackend.findUnique as ReturnType<typeof vi.fn>;
const mockUpsert = prisma.lead.upsert as ReturnType<typeof vi.fn>;
const mockNotify = dispatchNotification as ReturnType<typeof vi.fn>;
const mockMeta = getConversationMetadata as ReturnType<typeof vi.fn>;

const AGENT_ID = "agent-1";
const CONV_ID = "conv-1";

beforeEach(() => {
  mockBackend.mockReset();
  mockUpsert.mockReset();
  mockNotify.mockReset().mockResolvedValue(undefined);
  mockMeta.mockReset().mockResolvedValue({});
});

describe("calificar_lead — gate por capability leads", () => {
  it("agente sin backend (null) → error claro, sin tocar Prisma", async () => {
    mockBackend.mockResolvedValue(null);
    await expect(
      executeTool(AGENT_ID, "calificar_lead", { qualification: "hot", reason: "pide cita ya" }, CONV_ID)
    ).rejects.toThrow(/leads/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("managed_db sin capability leads (solo reservas) → error, sin tocar Prisma", async () => {
    mockBackend.mockResolvedValue({ mode: "managed_db", capabilities: ["reservas"] });
    await expect(
      executeTool(AGENT_ID, "calificar_lead", { qualification: "hot", reason: "x" }, CONV_ID)
    ).rejects.toThrow(/leads/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("managed_db con leads habilitado → permite calificar", async () => {
    mockBackend.mockResolvedValue({ mode: "managed_db", capabilities: ["leads"] });
    mockUpsert.mockResolvedValue({ id: "lead-1", customerName: "Ana" });

    const result = await executeTool(
      AGENT_ID,
      "calificar_lead",
      { qualification: "warm", reason: "pide info, sin fecha" },
      CONV_ID
    );
    expect(result).toMatchObject({ qualified: true, qualification: "warm" });
  });

  it("external_api con leads habilitado → mismo comportamiento (independiente del adapter)", async () => {
    mockBackend.mockResolvedValue({ mode: "external_api", capabilities: ["leads"] });
    mockUpsert.mockResolvedValue({ id: "lead-2", customerName: "Ana" });

    const result = await executeTool(
      AGENT_ID,
      "calificar_lead",
      { qualification: "cold", reason: "fuera de zona" },
      CONV_ID
    );
    expect(result).toMatchObject({ qualified: true, qualification: "cold" });
  });
});

describe("calificar_lead — persistencia (upsert por conversationId)", () => {
  beforeEach(() => {
    mockBackend.mockResolvedValue({ mode: "managed_db", capabilities: ["leads"] });
  });

  it("upsert con where.conversationId y create/update coherentes con qualification+reason", async () => {
    mockUpsert.mockResolvedValue({ id: "lead-3", customerName: "Visitante" });

    await executeTool(
      AGENT_ID,
      "calificar_lead",
      { qualification: "hot", reason: "pide precio y disponibilidad ya" },
      CONV_ID
    );

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where).toEqual({ conversationId: CONV_ID });
    expect(call.create).toMatchObject({
      agentId: AGENT_ID,
      conversationId: CONV_ID,
      qualification: "hot",
      qualificationReason: "pide precio y disponibilidad ya",
    });
    expect(call.update).toEqual({
      qualification: "hot",
      qualificationReason: "pide precio y disponibilidad ya",
    });
  });

  it("sin lead previo (upsert.create mínimo) usa customerName de metadata o 'Visitante'", async () => {
    mockMeta.mockResolvedValue({ leadFlow: { customerName: "Carlos" } });
    mockUpsert.mockResolvedValue({ id: "lead-4", customerName: "Carlos" });

    await executeTool(AGENT_ID, "calificar_lead", { qualification: "warm", reason: "lo piensa" }, CONV_ID);

    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.customerName).toBe("Carlos");
  });

  it("sin conversationId → no califica (qualified:false), sin tocar Prisma", async () => {
    const result = await executeTool(AGENT_ID, "calificar_lead", { qualification: "hot", reason: "x" });
    expect(result).toMatchObject({ qualified: false });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("qualification inválida (no hot|warm|cold) → error claro, sin tocar Prisma", async () => {
    await expect(
      executeTool(AGENT_ID, "calificar_lead", { qualification: "meh", reason: "x" }, CONV_ID)
    ).rejects.toThrow(/hot.*warm.*cold/i);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("calificar_lead — notificación al dueño (best-effort, solo hot)", () => {
  beforeEach(() => {
    mockBackend.mockResolvedValue({ mode: "managed_db", capabilities: ["leads"] });
  });

  it("hot → dispatchNotification('nuevo_lead', {...lead, qualification:'hot'})", async () => {
    mockUpsert.mockResolvedValue({ id: "lead-5", customerName: "Ana" });

    await executeTool(
      AGENT_ID,
      "calificar_lead",
      { qualification: "hot", reason: "acepta cita" },
      CONV_ID
    );

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(
      AGENT_ID,
      "nuevo_lead",
      expect.objectContaining({ id: "lead-5", customerName: "Ana", qualification: "hot" })
    );
  });

  it("warm → NO notifica", async () => {
    mockUpsert.mockResolvedValue({ id: "lead-6", customerName: "Ana" });
    await executeTool(AGENT_ID, "calificar_lead", { qualification: "warm", reason: "x" }, CONV_ID);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("cold → NO notifica", async () => {
    mockUpsert.mockResolvedValue({ id: "lead-7", customerName: "Ana" });
    await executeTool(AGENT_ID, "calificar_lead", { qualification: "cold", reason: "x" }, CONV_ID);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
