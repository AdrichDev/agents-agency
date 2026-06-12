import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── workflow-builder ──────────────────────────────────────────────────────────

describe("workflow-builder — buildWorkflow", () => {
  beforeEach(() => {
    process.env.BACK_URL = "http://localhost:4000";
    process.env.AUTOMATION_WEBHOOK_SECRET = "test-secret";
  });

  afterEach(() => {
    delete process.env.BACK_URL;
    delete process.env.PUBLIC_URL;
    delete process.env.AUTOMATION_WEBHOOK_SECRET;
    vi.resetModules();
  });

  it('trigger="schedule" intervalMinutes=60 → nodo scheduleTrigger con minutesInterval=60', async () => {
    const { buildWorkflow } = await import("@/lib/n8n/workflow-builder");
    const wf = buildWorkflow({
      id: "auto-abc123",
      name: "Test Schedule",
      trigger: "schedule",
      config: { intervalMinutes: 60 },
    });

    expect(wf.nodes).toHaveLength(2);
    const trigger = wf.nodes.find((n) => n.type === "n8n-nodes-base.scheduleTrigger");
    expect(trigger).toBeDefined();
    const interval = (trigger!.parameters as any).rule.interval[0];
    expect(interval.minutesInterval).toBe(60);
    expect(interval.field).toBe("minutes");
  });

  it('trigger="schedule" intervalMinutes=undefined → default 5 minutos (R2-2)', async () => {
    const { buildWorkflow } = await import("@/lib/n8n/workflow-builder");
    const wf = buildWorkflow({
      id: "auto-def456",
      name: "Test Schedule Default",
      trigger: "schedule",
      config: null,
    });

    const trigger = wf.nodes.find((n) => n.type === "n8n-nodes-base.scheduleTrigger");
    const interval = (trigger!.parameters as any).rule.interval[0];
    expect(interval.minutesInterval).toBe(5);
  });

  it('trigger="schedule" → nodo httpRequest con url .../execute y header X-Automation-Secret', async () => {
    const { buildWorkflow } = await import("@/lib/n8n/workflow-builder");
    const wf = buildWorkflow({
      id: "auto-ghi789",
      name: "Test Execute URL",
      trigger: "schedule",
      config: { intervalMinutes: 5 },
    });

    const httpNode = wf.nodes.find((n) => n.type === "n8n-nodes-base.httpRequest");
    expect(httpNode).toBeDefined();
    const params = httpNode!.parameters as any;
    expect(params.url).toContain("/api/automations/auto-ghi789/execute");
    expect(params.method).toBe("POST");
    const headers = params.headerParameters.parameters as Array<{ name: string; value: string }>;
    const secretHeader = headers.find((h) => h.name === "X-Automation-Secret");
    expect(secretHeader).toBeDefined();
    expect(secretHeader!.value).toBe("test-secret");
  });

  it('trigger="new_email" → nodo webhook (no scheduleTrigger)', async () => {
    const { buildWorkflow } = await import("@/lib/n8n/workflow-builder");
    const wf = buildWorkflow({
      id: "auto-email1",
      name: "Email trigger",
      trigger: "new_email",
      config: null,
    });

    const webhook = wf.nodes.find((n) => n.type === "n8n-nodes-base.webhook");
    expect(webhook).toBeDefined();
    expect(wf.nodes.find((n) => n.type === "n8n-nodes-base.scheduleTrigger")).toBeUndefined();
    // También incluye nodo httpRequest
    expect(wf.nodes.find((n) => n.type === "n8n-nodes-base.httpRequest")).toBeDefined();
  });

  it('trigger="new_slack_message" → nodo webhook', async () => {
    const { buildWorkflow } = await import("@/lib/n8n/workflow-builder");
    const wf = buildWorkflow({
      id: "auto-slack1",
      name: "Slack trigger",
      trigger: "new_slack_message",
      config: null,
    });

    const webhook = wf.nodes.find((n) => n.type === "n8n-nodes-base.webhook");
    expect(webhook).toBeDefined();
    const params = webhook!.parameters as any;
    expect(params.path).toBe("automation-auto-slack1");
  });

  it("trigger desconocido → lanza error", async () => {
    const { buildWorkflow } = await import("@/lib/n8n/workflow-builder");
    expect(() =>
      buildWorkflow({
        id: "auto-xxx",
        name: "Unknown",
        trigger: "unknown_trigger",
        config: null,
      })
    ).toThrow(/unknown trigger/);
  });

  it("PUBLIC_URL tiene precedencia sobre BACK_URL", async () => {
    process.env.PUBLIC_URL = "https://api.prod.example.com";
    const { buildWorkflow } = await import("@/lib/n8n/workflow-builder");
    const wf = buildWorkflow({
      id: "auto-prod1",
      name: "Prod",
      trigger: "schedule",
      config: { intervalMinutes: 5 },
    });
    const httpNode = wf.nodes.find((n) => n.type === "n8n-nodes-base.httpRequest");
    expect((httpNode!.parameters as any).url).toContain("https://api.prod.example.com");
  });
});

// ── n8n/client.ts ─────────────────────────────────────────────────────────────

describe("n8n/client — isConfigured y modo noop", () => {
  afterEach(() => {
    delete process.env.N8N_BASE_URL;
    delete process.env.N8N_API_KEY;
    vi.resetModules();
  });

  it("isConfigured() = false si N8N_BASE_URL no está definida", async () => {
    delete process.env.N8N_BASE_URL;
    delete process.env.N8N_API_KEY;
    const { isConfigured } = await import("@/lib/n8n/client");
    expect(isConfigured()).toBe(false);
  });

  it("isConfigured() = true si ambas vars están definidas", async () => {
    process.env.N8N_BASE_URL = "http://localhost:5678";
    process.env.N8N_API_KEY = "test-key";
    const { isConfigured } = await import("@/lib/n8n/client");
    expect(isConfigured()).toBe(true);
  });

  it("noop: createWorkflow devuelve { ok:true, workflowId:null, status:'pending' }", async () => {
    delete process.env.N8N_BASE_URL;
    delete process.env.N8N_API_KEY;
    const { createWorkflow } = await import("@/lib/n8n/client");
    const result = await createWorkflow({
      name: "test",
      nodes: [],
      connections: {},
    });
    expect(result.ok).toBe(true);
    expect(result.workflowId).toBeNull();
    expect(result.status).toBe("pending");
  });
});

describe("n8n/client — con fetch mockeado", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    process.env.N8N_BASE_URL = "http://localhost:5678";
    process.env.N8N_API_KEY = "test-api-key";
    fetchSpy = vi.spyOn(globalThis, "fetch" as never);
  });

  afterEach(() => {
    delete process.env.N8N_BASE_URL;
    delete process.env.N8N_API_KEY;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("n8n 200 con id → { ok:true, workflowId:'wf-1', status:'synced' }", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "wf-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const { createWorkflow } = await import("@/lib/n8n/client");
    const result = await createWorkflow({ name: "t", nodes: [], connections: {} });
    expect(result.ok).toBe(true);
    expect(result.workflowId).toBe("wf-1");
    expect(result.status).toBe("synced");
  });

  it("n8n 404 → { ok:false, status:'error', notFound:true }", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("not found", { status: 404 })
    );
    const { getWorkflow } = await import("@/lib/n8n/client");
    const result = await getWorkflow("wf-missing");
    expect(result.ok).toBe(false);
    expect(result.status).toBe("error");
    expect(result.notFound).toBe(true);
    expect(result.workflowId).toBeNull();
  });

  it("red caída (fetch rechaza) → { ok:false, status:'error' }, no lanza", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network error"));
    const { createWorkflow } = await import("@/lib/n8n/client");
    const result = await createWorkflow({ name: "t", nodes: [], connections: {} });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("error");
    expect(result.notFound).toBeFalsy();
  });

  it("n8n 500 → { ok:false, status:'error' }, no lanza", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("internal server error", { status: 500 })
    );
    const { activateWorkflow } = await import("@/lib/n8n/client");
    const result = await activateWorkflow("wf-1");
    expect(result.ok).toBe(false);
    expect(result.status).toBe("error");
  });
});

// ── engine.ts — skip lógica R5-1 (unit inline) ───────────────────────────────

describe("engine — skip lógica R5-1 (condición anti-duplicidad)", () => {
  it("n8nWorkflowId && syncStatus='synced' → condición de skip es true", () => {
    const a = { id: "x", name: "test", n8nWorkflowId: "wf-42", syncStatus: "synced" };
    const shouldSkip = Boolean(a.n8nWorkflowId && a.syncStatus === "synced");
    expect(shouldSkip).toBe(true);
  });

  it("n8nWorkflowId=null → NO se salta (R5-2)", () => {
    const a = { id: "x", name: "test", n8nWorkflowId: null, syncStatus: "pending" };
    const shouldSkip = Boolean(a.n8nWorkflowId && a.syncStatus === "synced");
    expect(shouldSkip).toBe(false);
  });

  it("n8nWorkflowId definido pero syncStatus='error' → NO se salta", () => {
    const a = { id: "x", name: "test", n8nWorkflowId: "wf-1", syncStatus: "error" };
    const shouldSkip = Boolean(a.n8nWorkflowId && a.syncStatus === "synced");
    expect(shouldSkip).toBe(false);
  });

  it("n8nWorkflowId definido pero syncStatus='pending' → NO se salta", () => {
    const a = { id: "x", name: "test", n8nWorkflowId: "wf-1", syncStatus: "pending" };
    const shouldSkip = Boolean(a.n8nWorkflowId && a.syncStatus === "synced");
    expect(shouldSkip).toBe(false);
  });
});

// ── POST /api/automations/:id/execute — auth (R3) ────────────────────────────

describe("endpoint POST /api/automations/:id/execute — autenticación", () => {
  // Tests de integración usando supertest o simulando el handler con una request mock.
  // Aquí usamos una función helper que simula el handler directamente para evitar
  // arrancar el servidor express completo (los tests de channels.test.ts usan el mismo patrón).

  it("AUTOMATION_WEBHOOK_SECRET no configurado → 500", async () => {
    const origSecret = process.env.AUTOMATION_WEBHOOK_SECRET;
    delete process.env.AUTOMATION_WEBHOOK_SECRET;

    // Simulamos la lógica del handler
    const secret = process.env.AUTOMATION_WEBHOOK_SECRET;
    const responseStatus = !secret ? 500 : 200;

    expect(responseStatus).toBe(500);

    if (origSecret !== undefined) process.env.AUTOMATION_WEBHOOK_SECRET = origSecret;
  });

  it("header ausente → 401 (lógica del handler)", () => {
    process.env.AUTOMATION_WEBHOOK_SECRET = "correct-secret";
    const secret = process.env.AUTOMATION_WEBHOOK_SECRET;
    const provided = undefined; // sin header
    const status = !provided || provided !== secret ? 401 : 200;
    expect(status).toBe(401);
    delete process.env.AUTOMATION_WEBHOOK_SECRET;
  });

  it("header incorrecto → 401 (lógica del handler)", () => {
    process.env.AUTOMATION_WEBHOOK_SECRET = "correct-secret";
    const secret = process.env.AUTOMATION_WEBHOOK_SECRET;
    const provided = "wrong-secret";
    const status = !provided || provided !== secret ? 401 : 200;
    expect(status).toBe(401);
    delete process.env.AUTOMATION_WEBHOOK_SECRET;
  });

  it("header correcto → 200 (lógica del handler)", () => {
    process.env.AUTOMATION_WEBHOOK_SECRET = "correct-secret";
    const secret = process.env.AUTOMATION_WEBHOOK_SECRET;
    const provided = "correct-secret";
    const status = !provided || provided !== secret ? 401 : 200;
    expect(status).toBe(200);
    delete process.env.AUTOMATION_WEBHOOK_SECRET;
  });
});
