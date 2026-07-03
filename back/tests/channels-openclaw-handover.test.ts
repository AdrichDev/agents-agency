/**
 * Integración de rutas — guard de doble respuesta en el handover de Telegram
 * a OpenClaw (F2-T3, openspec/changes/aa-openclaw-brain). Extrae el handler
 * real de POST /api/channels/telegram/connect del router (mismo patrón que
 * tests/market-study-iteration.test.ts: vi.doMock + import dinámico +
 * channelsRouter.stack) y lo invoca con req/res simulados. Mockea Telegram y
 * el admin RPC de OpenClaw — sin red real.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.json = vi.fn((b: any) => {
    res.body = b;
    return res;
  });
  return res;
}

interface Mocks {
  agentFindUnique: ReturnType<typeof vi.fn>;
  connectionUpsert: ReturnType<typeof vi.fn>;
  validateToken: ReturnType<typeof vi.fn>;
  registerWebhook: ReturnType<typeof vi.fn>;
  deleteWebhook: ReturnType<typeof vi.fn>;
  provisionTelegramChannel: ReturnType<typeof vi.fn>;
}

async function setupConnectRoute(agentRuntime: string | null): Promise<{ handler: any; mocks: Mocks }> {
  const agentFindUnique = vi.fn().mockResolvedValue({ runtime: agentRuntime });
  const connectionUpsert = vi.fn().mockResolvedValue({});
  const validateToken = vi.fn().mockResolvedValue({ first_name: "Bot", username: "mybot" });
  const registerWebhook = vi.fn().mockResolvedValue(undefined);
  const deleteWebhook = vi.fn().mockResolvedValue(undefined);
  const provisionTelegramChannel = vi.fn().mockResolvedValue({ ok: true, status: "synced", pendingRestart: true });

  vi.doMock("@/lib/db", () => ({
    prisma: {
      agent: { findUnique: agentFindUnique },
      channelConnection: { upsert: connectionUpsert },
    },
  }));
  vi.doMock("@/lib/crypto", () => ({ encrypt: vi.fn(() => ({ iv: "i", authTag: "a", data: "d" })) }));
  vi.doMock("@/lib/channels/telegram", () => ({
    validateToken,
    registerWebhook,
    deleteWebhook,
  }));
  vi.doMock("@/lib/channels/webhook-shared", () => ({
    PUBLIC_URL: () => "https://aa.example.com",
    encryptCreds: vi.fn((c: object) => ({ iv: "i", authTag: "a", data: JSON.stringify(c) })),
    decryptCreds: vi.fn(() => ({})),
  }));
  vi.doMock("@/lib/channels/telegram-webhook", () => ({ handleTelegramWebhook: vi.fn() }));
  vi.doMock("@/lib/channels/whatsapp-webhook", () => ({
    handleWhatsAppVerify: vi.fn(),
    handleWhatsAppWebhook: vi.fn(),
  }));
  vi.doMock("@/lib/openclaw/provision", () => ({ provisionTelegramChannel }));

  const { channelsRouter } = await import("@/routes/channels");
  const layer = (channelsRouter as any).stack.find(
    (l: any) => l.route?.path === "/:provider/connect" && l.route?.methods?.post
  );
  const routeStack = layer.route.stack;
  return {
    handler: routeStack[routeStack.length - 1].handle,
    mocks: { agentFindUnique, connectionUpsert, validateToken, registerWebhook, deleteWebhook, provisionTelegramChannel },
  };
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("POST /api/channels/telegram/connect — runtime='openai' (comportamiento de siempre)", () => {
  it("registra webhook, NO llama a provisionTelegramChannel, sin managedBy en metadata", async () => {
    const { handler, mocks } = await setupConnectRoute("openai");
    const res = mockRes();

    await handler({ params: { provider: "telegram" }, body: { agentId: "a1", token: "111:abc" } }, res);

    expect(mocks.registerWebhook).toHaveBeenCalledTimes(1);
    expect(mocks.deleteWebhook).not.toHaveBeenCalled();
    expect(mocks.provisionTelegramChannel).not.toHaveBeenCalled();
    expect(res.body.managedBy).toBeUndefined();

    const upsertArgs = mocks.connectionUpsert.mock.calls[0][0];
    expect(upsertArgs.create.metadata).toEqual({});
    expect(upsertArgs.create.webhookSecret).toEqual(expect.any(String));
  });
});

describe("POST /api/channels/telegram/connect — runtime='openclaw' (F2-T2/F2-T3 handover)", () => {
  it("NO registra webhook propio, borra webhook previo, y aprovisiona OpenClaw exactamente una vez", async () => {
    const { handler, mocks } = await setupConnectRoute("openclaw");
    const res = mockRes();

    await handler({ params: { provider: "telegram" }, body: { agentId: "a1", token: "111:abc" } }, res);

    // F2-T3: guard de doble respuesta — jamás registra webhook para conexiones openclaw-managed
    expect(mocks.registerWebhook).not.toHaveBeenCalled();
    // handover: borra cualquier webhook previo (p.ej. venía de runtime="openai")
    expect(mocks.deleteWebhook).toHaveBeenCalledTimes(1);
    expect(mocks.deleteWebhook).toHaveBeenCalledWith("111:abc");

    // exactamente UNA sincronización por escritura
    expect(mocks.provisionTelegramChannel).toHaveBeenCalledTimes(1);
    expect(mocks.provisionTelegramChannel).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "a1" })
    );

    expect(res.body.managedBy).toBe("openclaw");

    const upsertArgs = mocks.connectionUpsert.mock.calls[0][0];
    expect(upsertArgs.create.metadata).toEqual({ managedBy: "openclaw" });
    expect(upsertArgs.create.webhookSecret).toBeNull();
  });

  it("el fallo del admin RPC de OpenClaw NO rompe la respuesta HTTP (fail-soft)", async () => {
    const { handler, mocks } = await setupConnectRoute("openclaw");
    mocks.provisionTelegramChannel.mockRejectedValueOnce(new Error("gateway down"));
    const res = mockRes();

    await handler({ params: { provider: "telegram" }, body: { agentId: "a1", token: "111:abc" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("active");
  });
});
