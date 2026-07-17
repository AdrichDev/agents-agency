/**
 * T1.1 (aa-lead-whatsapp-kickoff F1, design.md §B) — `sendTemplate`.
 * `fetch` mockeado (sin red real): valida el body Graph API `type:"template"`
 * (name, language.code, parameters ordenados); sin variables → sin components;
 * respuesta no-2xx → throw honesto con status + detalle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTemplate } from "@/lib/channels/whatsapp";

const originalFetch = globalThis.fetch;

function okResponse() {
  return { ok: true, status: 200, text: vi.fn().mockResolvedValue("{}") } as unknown as Response;
}

describe("sendTemplate — Meta Graph API type:template", () => {
  beforeEach(() => {
    delete process.env.META_GRAPH_VERSION;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("POST correcto: url por phoneNumberId, Bearer, template.name/language.code y parameters en orden", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendTemplate(
      "PHONE_ID",
      "TOKEN_XYZ",
      "+34600111222",
      { name: "lead_primer_contacto", language: "es" },
      ["Ana", "corte"]
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/PHONE_ID/messages");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN_XYZ");

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "+34600111222",
      type: "template",
      template: {
        name: "lead_primer_contacto",
        language: { code: "es" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Ana" },
              { type: "text", text: "corte" },
            ],
          },
        ],
      },
    });
  });

  it("sin variables (bodyParams vacío) → template sin components", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendTemplate("PHONE_ID", "TOKEN", "+34600", { name: "aviso", language: "es" }, []);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.template.components).toBeUndefined();
    expect(body.template).toEqual({ name: "aviso", language: { code: "es" } });
  });

  it("respeta META_GRAPH_VERSION del entorno", async () => {
    process.env.META_GRAPH_VERSION = "v22.0";
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendTemplate("PID", "T", "+34600", { name: "t", language: "en" }, ["X"]);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v22.0/PID/messages");
  });

  it("respuesta no-2xx → lanza error con status + detalle", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue('{"error":{"message":"template not approved"}}'),
    } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      sendTemplate("PID", "T", "+34600", { name: "no_aprobada", language: "es" }, ["Ana"])
    ).rejects.toThrow(/Error Graph API \(400\).*template not approved/);
  });
});
