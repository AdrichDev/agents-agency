/**
 * Integración de rutas — conexión de Telegram bajo la arquitectura
 * «AA canal + cerebro OpenClaw» (5.4a, openspec/changes/
 * aa-centro-mando-agenda-telegram). AA es el hub de bots de clientes:
 * registra SIEMPRE su propio webhook por agente, sea cual sea el runtime,
 * y NUNCA entrega el token del bot a OpenClaw (su slot global
 * channels.telegram.botToken no soporta multi-bot). Sustituye al antiguo
 * handover F2 (aa-openclaw-brain), retirado.
 *
 * Extrae el handler real de POST /api/channels/telegram/connect del router
 * (mismo patrón que tests/market-study-iteration.test.ts: vi.doMock + import
 * dinámico + channelsRouter.stack) y lo invoca con req/res simulados. Mockea
 * Telegram y el módulo de provisioning de OpenClaw — sin red real.
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
  connectionUpsert: ReturnType<typeof vi.fn>;
  validateToken: ReturnType<typeof vi.fn>;
  registerWebhook: ReturnType<typeof vi.fn>;
  deleteWebhook: ReturnType<typeof vi.fn>;
  provisionTelegramChannel: ReturnType<typeof vi.fn>;
}

async function setupConnectRoute(): Promise<{ handler: any; mocks: Mocks }> {
  const connectionUpsert = vi.fn().mockResolvedValue({});
  const validateToken = vi.fn().mockResolvedValue({ first_name: "Bot", username: "mybot" });
  const registerWebhook = vi.fn().mockResolvedValue(undefined);
  const deleteWebhook = vi.fn().mockResolvedValue(undefined);
  const provisionTelegramChannel = vi.fn().mockResolvedValue({ ok: true, status: "synced", pendingRestart: true });

  vi.doMock("@/lib/db", () => ({
    prisma: {
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
    mocks: { connectionUpsert, validateToken, registerWebhook, deleteWebhook, provisionTelegramChannel },
  };
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("POST /api/channels/telegram/connect — AA hub (5.4a): mismo flujo para todo runtime", () => {
  it("registra el webhook de AA con secret, sin managedBy y SIN handover a OpenClaw", async () => {
    const { handler, mocks } = await setupConnectRoute();
    const res = mockRes();

    await handler({ params: { provider: "telegram" }, body: { agentId: "a1", token: "111:abc" } }, res);

    // AA registra su propio webhook por agente ({PUBLIC_URL}/api/channels/telegram/:agentId)
    expect(mocks.registerWebhook).toHaveBeenCalledTimes(1);
    expect(mocks.registerWebhook).toHaveBeenCalledWith(
      "111:abc",
      "https://aa.example.com/api/channels/telegram/a1",
      expect.any(String)
    );
    expect(mocks.deleteWebhook).not.toHaveBeenCalled();

    // El token del bot NUNCA viaja al slot global de OpenClaw
    expect(mocks.provisionTelegramChannel).not.toHaveBeenCalled();

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("active");
    expect(res.body.managedBy).toBeUndefined();

    const upsertArgs = mocks.connectionUpsert.mock.calls[0][0];
    expect(upsertArgs.create.metadata).toEqual({});
    expect(upsertArgs.create.webhookSecret).toEqual(expect.any(String));
    expect(upsertArgs.update.webhookSecret).toEqual(expect.any(String));
    expect(upsertArgs.update.metadata).toEqual({});
  });

  it("la reconexión de un agente antes openclaw-managed limpia metadata y repone webhookSecret", async () => {
    const { handler, mocks } = await setupConnectRoute();
    const res = mockRes();

    // La ruta ya no consulta el runtime del agente: el comportamiento es
    // idéntico para openai/openclaw. El update del upsert pisa metadata con {}
    // (borra managedBy heredado) y guarda un webhookSecret no nulo.
    await handler({ params: { provider: "telegram" }, body: { agentId: "openclaw-agent", token: "222:def" } }, res);

    expect(mocks.registerWebhook).toHaveBeenCalledTimes(1);
    expect(mocks.provisionTelegramChannel).not.toHaveBeenCalled();
    const upsertArgs = mocks.connectionUpsert.mock.calls[0][0];
    expect(upsertArgs.update.metadata).toEqual({});
    expect(upsertArgs.update.webhookSecret).not.toBeNull();
  });

  it("si Telegram rechaza el setWebhook → 502 y no se persiste conexión", async () => {
    const { handler, mocks } = await setupConnectRoute();
    mocks.registerWebhook.mockRejectedValueOnce(new Error("bad webhook"));
    const res = mockRes();

    await handler({ params: { provider: "telegram" }, body: { agentId: "a1", token: "111:abc" } }, res);

    expect(res.statusCode).toBe(502);
    expect(mocks.connectionUpsert).not.toHaveBeenCalled();
    expect(mocks.provisionTelegramChannel).not.toHaveBeenCalled();
  });
});
