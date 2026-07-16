/**
 * T5 (aa-agent-backend-foundation, validation.md, AC8) — import de workflows
 * n8n como automatizaciones con SCOPING ESTRICTO por agente:
 *  - Pegar JSON: sanea el workflow, lo crea en NUESTRA instancia con el tag
 *    [agent:<id>] y persiste la Automation vinculada.
 *  - Adoptar por ID: rechaza workflows vinculados o tagueados a OTRO agente
 *    (sin cruce de tenants).
 *  - El cron interno NUNCA ejecuta automatizaciones importadas.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn() },
    automation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    automationRun: { create: vi.fn() },
  },
}));
vi.mock("@/lib/n8n/client", () => ({
  isConfigured: vi.fn(() => true),
  createWorkflow: vi.fn(),
  activateWorkflow: vi.fn().mockResolvedValue({ ok: true, workflowId: "wf-9", status: "synced" }),
  getWorkflowDetail: vi.fn(),
  listWorkflowExecutions: vi.fn(),
}));
// El motor importa runAgent (grafo pesado) — no se ejercita aquí.
vi.mock("@/lib/agent/engine", () => ({ runAgent: vi.fn() }));

import { prisma } from "@/lib/db";
import * as n8n from "@/lib/n8n/client";
import { HttpError } from "@/lib/http";
import {
  importWorkflowForAgent,
  sanitizeWorkflowJson,
  buildScopedWorkflowName,
  agentIdFromWorkflowName,
  IMPORTED_TRIGGER,
} from "@/lib/automations/import";
import { runAutomations } from "@/lib/automations/engine";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const VALID_WF = {
  name: "Aviso diario",
  nodes: [{ id: "n1", name: "Cron", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1, position: [0, 0], parameters: {} }],
  connections: { Cron: { main: [[]] } },
  pinData: { secreto: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  asMock(n8n.isConfigured).mockReturnValue(true);
  asMock(prisma.agent.findUnique).mockResolvedValue({ id: "ag-1" });
  asMock(prisma.automation.findFirst).mockResolvedValue(null);
  asMock(prisma.automation.create).mockImplementation(async ({ data }: any) => ({ id: "auto-1", ...data }));
});

describe("sanitizeWorkflowJson", () => {
  it("rechaza JSON sin nodes o sin connections", () => {
    expect(() => sanitizeWorkflowJson("no soy un objeto")).toThrow(HttpError);
    expect(() => sanitizeWorkflowJson({ connections: {} })).toThrow(/nodes/);
    expect(() => sanitizeWorkflowJson({ nodes: VALID_WF.nodes })).toThrow(/connections/);
  });

  it("conserva SOLO name/nodes/connections/settings (pinData fuera)", () => {
    const wf = sanitizeWorkflowJson(VALID_WF) as unknown as Record<string, unknown>;
    expect(wf.name).toBe("Aviso diario");
    expect(wf.nodes).toHaveLength(1);
    expect(wf).not.toHaveProperty("pinData");
  });
});

describe("scoping por agente en el nombre del workflow", () => {
  it("taguea y parsea el agentId", () => {
    const name = buildScopedWorkflowName("ag-1", "Aviso diario");
    expect(name).toBe("[agent:ag-1] Aviso diario");
    expect(agentIdFromWorkflowName(name)).toBe("ag-1");
    expect(agentIdFromWorkflowName("sin tag")).toBeNull();
  });
});

describe("importWorkflowForAgent — pegar JSON", () => {
  it("crea el workflow scopeado en n8n y persiste la Automation vinculada", async () => {
    asMock(n8n.createWorkflow).mockResolvedValue({ ok: true, workflowId: "wf-9", status: "synced" });

    const automation = await importWorkflowForAgent({ agentId: "ag-1", workflowJson: VALID_WF });

    expect(n8n.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ name: "[agent:ag-1] Aviso diario" })
    );
    expect(n8n.activateWorkflow).toHaveBeenCalledWith("wf-9");
    expect(prisma.automation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: "ag-1",
        trigger: IMPORTED_TRIGGER,
        prompt: "",
        n8nWorkflowId: "wf-9",
        syncStatus: "synced",
        config: { imported: true, source: "json" },
      }),
    });
    expect(automation.name).toBe("Aviso diario");
  });

  it("n8n en noop (sin configurar): queda pending sin activar", async () => {
    asMock(n8n.createWorkflow).mockResolvedValue({ ok: true, workflowId: null, status: "pending" });

    await importWorkflowForAgent({ agentId: "ag-1", workflowJson: VALID_WF, name: "Mi flujo" });

    expect(n8n.activateWorkflow).not.toHaveBeenCalled();
    expect(prisma.automation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Mi flujo", n8nWorkflowId: null, syncStatus: "pending" }),
    });
  });

  it("exige exactamente uno de workflowJson | n8nWorkflowId", async () => {
    await expect(importWorkflowForAgent({ agentId: "ag-1" })).rejects.toThrow(/exactamente uno/);
    await expect(
      importWorkflowForAgent({ agentId: "ag-1", workflowJson: VALID_WF, n8nWorkflowId: "wf-9" })
    ).rejects.toThrow(/exactamente uno/);
  });
});

describe("importWorkflowForAgent — adoptar por ID (scoping estricto)", () => {
  it("rechaza (409) un workflow ya vinculado a OTRO agente", async () => {
    asMock(prisma.automation.findFirst).mockResolvedValue({ id: "auto-x", agentId: "ag-OTRO" });

    await expect(
      importWorkflowForAgent({ agentId: "ag-1", n8nWorkflowId: "wf-9" })
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.automation.create).not.toHaveBeenCalled();
  });

  it("rechaza (403) un workflow cuyo nombre lleva el tag de OTRO agente", async () => {
    asMock(n8n.getWorkflowDetail).mockResolvedValue({ id: "wf-9", name: "[agent:ag-OTRO] Flujo ajeno" });

    await expect(
      importWorkflowForAgent({ agentId: "ag-1", n8nWorkflowId: "wf-9" })
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.automation.create).not.toHaveBeenCalled();
  });

  it("rechaza (503) si n8n no está configurado", async () => {
    asMock(n8n.isConfigured).mockReturnValue(false);

    await expect(
      importWorkflowForAgent({ agentId: "ag-1", n8nWorkflowId: "wf-9" })
    ).rejects.toMatchObject({ status: 503 });
  });

  it("adopta un workflow propio: Automation synced con el nombre sin tag", async () => {
    asMock(n8n.getWorkflowDetail).mockResolvedValue({ id: "wf-9", name: "[agent:ag-1] Aviso diario" });

    const automation = await importWorkflowForAgent({ agentId: "ag-1", n8nWorkflowId: "wf-9" });

    expect(automation.name).toBe("Aviso diario");
    expect(prisma.automation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: "ag-1",
        n8nWorkflowId: "wf-9",
        syncStatus: "synced",
        config: { imported: true, source: "instance" },
      }),
    });
  });
});

describe("cron interno — nunca ejecuta workflows importados", () => {
  it("runAutomations omite trigger=imported aunque no estén synced", async () => {
    asMock(prisma.automation.findMany).mockResolvedValue([
      { id: "auto-1", trigger: "imported", n8nWorkflowId: null, syncStatus: "pending", name: "Importada" },
    ]);

    const results = await runAutomations();

    expect(results).toEqual([]);
    expect(prisma.automation.findUnique).not.toHaveBeenCalled();
  });
});
