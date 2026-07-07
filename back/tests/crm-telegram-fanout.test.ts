/**
 * Tests de fanOutTelegramToCrm (5.4c/5.4e aa-centro-mando-agenda-telegram):
 * contrato del puente AA→CRM hacia `/service/operator/telegram`. Gap de
 * cobertura detectado en la auditoría de 5.4 (no existía test dedicado pese a
 * estar cableado en 3 call-sites: telegram-webhook.ts x2, service-telegram.ts x1).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fanOutTelegramToCrm } from "@/lib/channels/crm-telegram-fanout";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.CRM_BASE_URL = "http://crm-back:4000";
  delete process.env.CRM_TELEGRAM_WEBHOOK_URL;
  process.env.OPERATOR_SERVICE_TOKEN = "shared-service-token";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fanOutTelegramToCrm", () => {
  it("POSTea a CRM_BASE_URL + /service/operator/telegram con el token compartido", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await fanOutTelegramToCrm({
      businessId: "biz-1",
      conversationId: "conv-1",
      direction: "in",
      text: "hola desde Telegram",
      providerMessageId: "tg-msg-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://crm-back:4000/service/operator/telegram");
    expect(init.method).toBe("POST");
    expect(init.headers["x-service-token"]).toBe("shared-service-token");
    expect(JSON.parse(init.body)).toEqual({
      businessId: "biz-1",
      conversationId: "conv-1",
      direction: "in",
      text: "hola desde Telegram",
      providerMessageId: "tg-msg-1",
    });
  });

  it("respeta CRM_TELEGRAM_WEBHOOK_URL explícito por encima de CRM_BASE_URL", async () => {
    process.env.CRM_TELEGRAM_WEBHOOK_URL = "http://crm-back:4000/service/operator/telegram/webhook";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await fanOutTelegramToCrm({ businessId: "biz-1", conversationId: "conv-1", direction: "out", text: "respuesta" });

    expect(fetchMock.mock.calls[0][0]).toBe("http://crm-back:4000/service/operator/telegram/webhook");
  });

  it("no-op silencioso sin CRM_BASE_URL/CRM_TELEGRAM_WEBHOOK_URL configurado", async () => {
    delete process.env.CRM_BASE_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await fanOutTelegramToCrm({ businessId: "biz-1", conversationId: "conv-1", direction: "in", text: "hola" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-op silencioso sin businessId (el mapeo negocio↔agente aún puede faltar)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await fanOutTelegramToCrm({ businessId: null, conversationId: "conv-1", direction: "in", text: "hola" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("best-effort: no lanza si el CRM responde error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fanOutTelegramToCrm({ businessId: "biz-1", conversationId: "conv-1", direction: "out", text: "hola" })
    ).resolves.toBeUndefined();
  });

  it("best-effort: no lanza si fetch rechaza (CRM caído/red)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fanOutTelegramToCrm({ businessId: "biz-1", conversationId: "conv-1", direction: "in", text: "hola" })
    ).resolves.toBeUndefined();
  });
});

/**
 * Contrato cross-app (5.4e): los dos flujos que deben espejar mensajes hacia
 * el CRM invocan fanOutTelegramToCrm con la `direction` correcta y UNA sola
 * vez por mensaje — confirmado por lectura de código (no re-testeado aquí
 * para no duplicar los mocks de Prisma/Telegram de sus propias suites):
 *
 *  - Inbound de un bot de cliente (telegram-webhook.ts): fan-out direction
 *    "in" tras persistir el mensaje entrante, y otro "out" tras la respuesta
 *    automática del agente — cada uno una sola vez por evento.
 *  - Respuesta manual del operador vía CRM (service-telegram.ts /send):
 *    fan-out direction "out" UNA vez, solo tras el `create` exitoso del
 *    Message saliente (nunca si `tgSendMessage` falla antes, por el early
 *    return con 502).
 */
