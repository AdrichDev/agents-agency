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
    pendingRestart: true,
  }),
}));

import { prisma } from "@/lib/db";
import { createAgent } from "@/lib/agent/service";
import { syncAgentProvisioning } from "@/lib/openclaw/provision";
import { nextClientCode } from "@/lib/codes";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.tenant.findUnique).mockResolvedValue({
    id: "tenant-existing",
    name: "Clinica Norte",
    codigo: "cli-07",
    sector: "salud",
  });
  asMock(prisma.agent.create).mockResolvedValue({
    id: "agent-1",
    name: "Agente Clinica Norte",
    sector: "salud",
    systemPrompt: "Responde como recepcionista dental.",
    runtime: "openclaw",
    temperature: 0.2,
    tenantId: "tenant-existing",
    tenant: { id: "tenant-existing", name: "Clinica Norte", codigo: "cli-07" },
  });
  asMock(prisma.agent.update).mockImplementation(async ({ data }: any) => ({
    ...(await asMock(prisma.agent.create).mock.results[0]?.value),
    ecommerceConfig: data.ecommerceConfig,
    openclawProvisioning: data.ecommerceConfig?.openclawProvisioning,
  }));
  asMock(prisma.budget.create).mockResolvedValue({ id: "budget-1" });
});

describe("createAgent with existing tenant + OpenClaw", () => {
  it("connects an existing tenant instead of creating a duplicate client and returns persisted provisioning status", async () => {
    const agent = await createAgent({
      name: "Agente Clinica Norte",
      sector: "salud",
      systemPrompt: "Responde como recepcionista dental.",
      model: "gpt-4.1-nano",
      runtime: "openclaw",
      reasoningEffort: "low",
      temperature: 0.2,
      channel: "telegram",
      tenantId: "tenant-existing",
      clientName: "Clinica Norte",
      website: "https://clinicanorte.example",
      skillIds: [],
      dataBackend: { mode: "none_yet" },
    });

    expect(nextClientCode).not.toHaveBeenCalled();
    expect(prisma.agent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runtime: "openclaw",
          tenant: { connect: { id: "tenant-existing" } },
        }),
        include: { tenant: true },
      }),
    );
    expect((prisma.agent.create as any).mock.calls[0][0].data.tenant.create).toBeUndefined();
    expect(syncAgentProvisioning).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "agent-1",
        name: "Agente Clinica Norte",
        runtime: "openclaw",
        systemPrompt: "Responde como recepcionista dental.",
      }),
    );
    expect(prisma.agent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "agent-1" },
        data: expect.objectContaining({
          ecommerceConfig: expect.objectContaining({
            openclawProvisioning: expect.objectContaining({ status: "provisioned" }),
          }),
        }),
      }),
    );
    expect((agent as any).openclawProvisioning.status).toBe("provisioned");
  });
});
